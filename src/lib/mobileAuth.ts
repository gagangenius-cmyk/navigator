import { randomUUID } from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { buildAuthSessionForEmployeeId, generateToken, type AuthUser } from './auth';
import { ensureMobileTables } from './mobileSchema';
import {
  decideRefresh,
  generateRefreshToken,
  getMobileAuthConfig,
  hashRefreshToken,
  type MobileAuthConfig,
} from './mobileAuthCore';

export { decideRefresh, generateRefreshToken, getMobileAuthConfig, hashRefreshToken };
export type { MobileAuthConfig };

// Session lifecycle for the React Native app (see /mobile).
//
// The web app keeps one 24h JWT in an httpOnly cookie. That doesn't suit a
// phone: the token can't be read from JS, it can't be revoked, and its
// permission snapshot goes stale for a day. The mobile flow instead issues:
//   - a short-lived access token - the *same* JWT shape requireAuth() already
//     verifies, so every existing Bearer-capable API route accepts it as is;
//   - a rotating refresh token, stored only as a sha256 hash, that is
//     re-validated against crm_employee on every use (deactivated employees
//     lose access within one access-token lifetime) and rebuilds permissions
//     fresh (role changes propagate without a re-login).

export interface MobileSessionMeta {
  deviceName?: string | null;
  platform?: string | null;
  ip?: string | null;
}

export interface MobileUserPayload {
  id: number;
  name: string;
  email: string;
  cemail: string;
  role: number;
  branch: number;
  region: number;
  type: string;
  roleName: string;
  photo?: string;
  wfh: number;
  permissions: string[];
  mustChangePassword: boolean;
}

export interface MobileTokenBundle {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  user: MobileUserPayload;
}

export type MobileAuthFailure = { ok: false; status: number; code: string; error: string };
export type MobileAuthResult = { ok: true; bundle: MobileTokenBundle } | MobileAuthFailure;

export function toMobileUser(user: AuthUser): MobileUserPayload {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    cemail: user.cemail,
    role: user.role,
    branch: user.branch,
    region: user.region,
    type: user.type,
    roleName: user.roleName,
    photo: user.photo,
    wfh: user.wfh,
    permissions: user.permissions,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

const fail = (status: number, code: string, error: string): MobileAuthFailure => ({ ok: false, status, code, error });

function mintAccessToken(user: AuthUser, config: MobileAuthConfig): string {
  // `token` is the web 24h JWT built by buildAuthUser(); the mobile access
  // token is minted from the same claims with the short mobile TTL instead.
  const { token: _webToken, ...claims } = user;
  void _webToken;
  return generateToken(claims, config.accessTtlSeconds);
}

// ---------- session operations -----------------------------------------

/** Starts a brand-new session family after a successful password (+MFA) login. */
export async function issueMobileSession(user: AuthUser, meta: MobileSessionMeta): Promise<MobileTokenBundle> {
  await ensureMobileTables();
  const config = getMobileAuthConfig();
  const refreshToken = generateRefreshToken();

  await sequelize.query(
    `INSERT INTO crm_mobile_sessions
       (employee_id, family_id, token_hash, family_started_at, expires_at, device_name, platform, ip_address, last_used_at)
     VALUES
       (:employeeId, :familyId, :hash, NOW(), DATE_ADD(NOW(), INTERVAL :ttl SECOND), :deviceName, :platform, :ip, NOW())`,
    {
      replacements: {
        employeeId: user.id,
        familyId: randomUUID(),
        hash: hashRefreshToken(refreshToken),
        ttl: config.refreshTtlSeconds,
        deviceName: meta.deviceName?.slice(0, 150) ?? null,
        platform: meta.platform?.slice(0, 20) ?? null,
        ip: meta.ip?.slice(0, 64) ?? null,
      },
    },
  );

  return {
    accessToken: mintAccessToken(user, config),
    refreshToken,
    expiresIn: config.accessTtlSeconds,
    user: toMobileUser(user),
  };
}

interface SessionRow {
  id: number;
  employee_id: number;
  family_id: string;
  revoked: number;
  revoked_ago: number | null;
  expired: number;
  family_age: number;
}

const revokeFamilySql = `UPDATE crm_mobile_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE family_id = :familyId`;

/** Exchanges a refresh token for a new access + refresh pair (rotation). */
export async function rotateMobileSession(refreshToken: string, meta: MobileSessionMeta): Promise<MobileAuthResult> {
  await ensureMobileTables();
  const config = getMobileAuthConfig();
  const tx = await sequelize.transaction();

  try {
    // FOR UPDATE serialises concurrent refreshes of the same token, so exactly
    // one caller rotates it and the other sees it as already revoked (grace).
    const [row] = await sequelize.query<SessionRow>(
      `SELECT id, employee_id, family_id,
              (revoked_at IS NOT NULL) AS revoked,
              TIMESTAMPDIFF(SECOND, revoked_at, NOW()) AS revoked_ago,
              (expires_at <= NOW()) AS expired,
              TIMESTAMPDIFF(SECOND, family_started_at, NOW()) AS family_age
       FROM crm_mobile_sessions
       WHERE token_hash = :hash
       LIMIT 1
       FOR UPDATE`,
      { replacements: { hash: hashRefreshToken(refreshToken) }, type: QueryTypes.SELECT, transaction: tx },
    );

    if (!row) {
      await tx.rollback();
      return fail(401, 'invalid_refresh_token', 'Session is no longer valid. Please sign in again.');
    }

    const decision = decideRefresh(
      {
        revoked: Boolean(row.revoked),
        revokedAgoSeconds: row.revoked_ago === null ? null : Number(row.revoked_ago),
        expired: Boolean(row.expired),
        familyAgeSeconds: Number(row.family_age),
      },
      config,
    );

    if (decision === 'grace') {
      await tx.rollback();
      return fail(409, 'refresh_conflict', 'A refresh for this session is already in progress.');
    }
    if (decision === 'reuse') {
      await sequelize.query(revokeFamilySql, { replacements: { familyId: row.family_id }, transaction: tx });
      await tx.commit();
      return fail(401, 'session_revoked', 'Session was revoked. Please sign in again.');
    }
    if (decision === 'expired') {
      await tx.rollback();
      return fail(401, 'session_expired', 'Session expired. Please sign in again.');
    }

    // Re-check the employee is still active and rebuild permissions fresh.
    const user = await buildAuthSessionForEmployeeId(row.employee_id);
    if (!user) {
      await sequelize.query(revokeFamilySql, { replacements: { familyId: row.family_id }, transaction: tx });
      await tx.commit();
      return fail(401, 'account_inactive', 'This account is no longer active.');
    }

    const nextToken = generateRefreshToken();
    const [insertedId] = await sequelize.query(
      `INSERT INTO crm_mobile_sessions
         (employee_id, family_id, token_hash, family_started_at, expires_at, device_name, platform, ip_address, last_used_at)
       SELECT employee_id, family_id, :nextHash, family_started_at,
              LEAST(DATE_ADD(NOW(), INTERVAL :ttl SECOND), DATE_ADD(family_started_at, INTERVAL :maxSession SECOND)),
              COALESCE(:deviceName, device_name), COALESCE(:platform, platform), :ip, NOW()
       FROM crm_mobile_sessions
       WHERE id = :id`,
      {
        replacements: {
          nextHash: hashRefreshToken(nextToken),
          ttl: config.refreshTtlSeconds,
          maxSession: config.maxSessionSeconds,
          deviceName: meta.deviceName?.slice(0, 150) ?? null,
          platform: meta.platform?.slice(0, 20) ?? null,
          ip: meta.ip?.slice(0, 64) ?? null,
          id: row.id,
        },
        type: QueryTypes.INSERT,
        transaction: tx,
      },
    );

    await sequelize.query(
      `UPDATE crm_mobile_sessions SET revoked_at = NOW(), replaced_by = :newId, last_used_at = NOW() WHERE id = :id`,
      { replacements: { newId: insertedId, id: row.id }, transaction: tx },
    );

    await tx.commit();

    return {
      ok: true,
      bundle: {
        accessToken: mintAccessToken(user, config),
        refreshToken: nextToken,
        expiresIn: config.accessTtlSeconds,
        user: toMobileUser(user),
      },
    };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

/** Ends the session family a refresh token belongs to. Returns its employee id. */
export async function revokeMobileSessionByToken(refreshToken: string): Promise<number | null> {
  await ensureMobileTables();
  const [row] = await sequelize.query<{ employee_id: number; family_id: string }>(
    `SELECT employee_id, family_id FROM crm_mobile_sessions WHERE token_hash = :hash LIMIT 1`,
    { replacements: { hash: hashRefreshToken(refreshToken) }, type: QueryTypes.SELECT },
  );
  if (!row) return null;
  await sequelize.query(revokeFamilySql, { replacements: { familyId: row.family_id } });
  return row.employee_id;
}

/** Signs an employee out of every device (e.g. after a password reset). */
export async function revokeAllMobileSessionsForEmployee(employeeId: number): Promise<void> {
  await ensureMobileTables();
  await sequelize.query(
    `UPDATE crm_mobile_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE employee_id = :employeeId`,
    { replacements: { employeeId } },
  );
}
