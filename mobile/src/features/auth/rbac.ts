import type { SessionUser } from './types';

// Role and permission helpers, mirroring the web app's src/lib/roleChecks.ts.
// These decide what the app *shows*; the server re-checks every request, so a
// gap here can never grant access - it can only hide or expose a button.

const norm = (value?: string | null) => (value ?? '').trim().toLowerCase();
const typeOf = (user: Pick<SessionUser, 'type'>) => norm(user.type).replace(/[\s-]+/g, '_');

type RoleFields = Pick<SessionUser, 'roleName' | 'type'>;
type PermissionFields = Pick<SessionUser, 'permissions'>;

/** 'all' is the wildcard granted to the CEO and other top-level roles. */
export function hasPermission(user: PermissionFields | null | undefined, ...keys: string[]): boolean {
  if (!user) return false;
  if (user.permissions.includes('all')) return true;
  return keys.some((key) => user.permissions.includes(key));
}

/**
 * The CEO is identified by the literal role name: `type` ("director") is shared
 * with Director / Founder / Super Admin roles.
 */
export const isCeo = (user: RoleFields | null | undefined): boolean => !!user && norm(user.roleName) === 'ceo';

const isTeamLeaderOrAreaManager = (user: RoleFields) => ['team_leader', 'area_manager'].includes(typeOf(user));

/** Roles that can approve discounts and compliance reviews (CEO plus the manager tier). */
export const isBranchManagerOrCeo = (user: RoleFields | null | undefined): boolean =>
  !!user &&
  (isCeo(user) ||
    isTeamLeaderOrAreaManager(user) ||
    ['branch_manager', 'bm'].includes(typeOf(user)) ||
    norm(user.roleName) === 'branch manager');

export const isCounsellor = (user: RoleFields | null | undefined): boolean => {
  if (!user) return false;
  const type = typeOf(user);
  return (
    ['senior_immigration_advisor', 'immigration_advisor', 'counsellor', 'counselor'].includes(type) ||
    /advisor|counsel/.test(norm(user.roleName))
  );
};

/** Accounts / finance users who verify submitted payments. */
export const canVerifyPayments = (user: (RoleFields & PermissionFields) | null | undefined): boolean =>
  hasPermission(user, 'finance.view', 'finance.manage', 'payments.view');

export const canApproveDiscounts = (user: RoleFields | null | undefined): boolean => isBranchManagerOrCeo(user);
export const canReviewCompliance = (user: RoleFields | null | undefined): boolean => isBranchManagerOrCeo(user);

/** Whether the Approvals tab has anything for this user. */
export function canSeeApprovals(user: (RoleFields & PermissionFields) | null | undefined): boolean {
  return canApproveDiscounts(user) || canReviewCompliance(user) || canVerifyPayments(user);
}

export type HomeVariant = 'executive' | 'manager' | 'counselor' | 'general';

/** Which dashboard layout to show. Mirrors the web's role-specific home pages. */
export function homeVariant(user: (RoleFields & PermissionFields) | null | undefined): HomeVariant {
  if (!user) return 'general';
  if (isCeo(user) || hasPermission(user, 'all') || typeOf(user) === 'director_of_sales') return 'executive';
  if (isTeamLeaderOrAreaManager(user) || isBranchManagerOrCeo(user)) return 'manager';
  if (isCounsellor(user)) return 'counselor';
  return 'general';
}
