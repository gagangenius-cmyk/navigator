import { isCeo } from './roleChecks';

type AccessActor = {
  permissions?: string[] | null;
  roleName?: string | null;
  type?: string | null;
  role?: string | number | null;
} | null | undefined;

// Who may create/edit roles, define permission keys and change which keys a
// role holds: the CEO, plus the full-admin tier (Super Admin/Director/Founder
// carry the literal 'all' permission). Holding roles.manage or admin.access
// alone is NOT enough - those are shared by far wider groups and would let any
// of them rewrite their own role's access.
export function canAdministerAccess(user: AccessActor): boolean {
  return isCeo(user) || Boolean(user?.permissions?.includes('all'));
}

// Valid permission key: lowercase module segment(s) + action, e.g. "hr.payroll",
// "hr.team.attendance_leave". Keeps keys greppable and stops free-text keys
// like "all" or "*" from being minted through the UI.
export const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

// Pure core of the "assign this role" escalation guard (see checkRoleAssignable
// in accessAdmin.ts): a non-admin may only hand out a role whose permissions
// are all ones they hold themselves, and never an 'all' (administrator) role.
export function canGrantPermissions(actor: AccessActor, target: string[]): { ok: true } | { ok: false; error: string } {
  if (canAdministerAccess(actor)) return { ok: true };
  if (target.includes('all')) {
    return { ok: false, error: 'Only the CEO can assign an administrator role' };
  }
  const held = new Set(actor?.permissions || []);
  if (target.some((key) => !held.has(key))) {
    return { ok: false, error: 'You cannot assign a role with more access than your own' };
  }
  return { ok: true };
}
