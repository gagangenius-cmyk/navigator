import { createHash, randomBytes } from 'crypto';

// Pure (no DB) half of the mobile session logic - see mobileAuth.ts for the
// how and why. Split out so the token-hygiene and rotation rules can be unit
// tested without a database.

export interface MobileAuthConfig {
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  maxSessionSeconds: number;
  reuseGraceSeconds: number;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function getMobileAuthConfig(): MobileAuthConfig {
  return {
    accessTtlSeconds: intEnv('MOBILE_ACCESS_TOKEN_TTL', 60 * 60, 60, 24 * 60 * 60),
    refreshTtlSeconds: intEnv('MOBILE_REFRESH_TTL_DAYS', 30, 1, 365) * 24 * 60 * 60,
    maxSessionSeconds: intEnv('MOBILE_SESSION_MAX_DAYS', 90, 1, 730) * 24 * 60 * 60,
    // Two refresh calls racing with the same token (a retry after a dropped
    // response) must not look like token theft for this many seconds.
    reuseGraceSeconds: 10,
  };
}

export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface RefreshRowState {
  revoked: boolean;
  /** Seconds since revocation, null when not revoked. */
  revokedAgoSeconds: number | null;
  expired: boolean;
  /** Seconds since the session family was first created. */
  familyAgeSeconds: number;
}

export type RefreshDecision = 'ok' | 'expired' | 'reuse' | 'grace';

/**
 * Decides what to do with a presented refresh token:
 *  - ok:      valid, rotate it
 *  - grace:   revoked a moment ago - most likely a retry of a refresh whose
 *             response was lost; refuse this call but leave the session alone
 *  - reuse:   revoked earlier - a rotated-out token is being replayed, which
 *             means it leaked; the whole family must be revoked
 *  - expired: past its sliding expiry or the absolute session cap
 */
export function decideRefresh(state: RefreshRowState, config: MobileAuthConfig): RefreshDecision {
  if (state.revoked) {
    return (state.revokedAgoSeconds ?? Number.POSITIVE_INFINITY) <= config.reuseGraceSeconds ? 'grace' : 'reuse';
  }
  if (state.expired || state.familyAgeSeconds >= config.maxSessionSeconds) return 'expired';
  return 'ok';
}
