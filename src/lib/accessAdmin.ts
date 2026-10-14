import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { CrmRole } from '../models';
import { getModulePermissionsForRole } from './modulePermissions';

import { canAdministerAccess, canGrantPermissions } from './accessPolicy';

export { canAdministerAccess, PERMISSION_KEY_PATTERN } from './accessPolicy';

type AccessActor = Parameters<typeof canAdministerAccess>[0];

export async function getEffectivePermissionsForRoleId(roleId: number): Promise<string[] | null> {
  const role = await CrmRole.findByPk(roleId, { raw: true }).catch(() => null);
  if (!role) return null;

  const rows = await sequelize.query<{ permission_key: string }>(
    `SELECT p.permission_key
     FROM crm_role_permissions rp
     INNER JOIN crm_permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = :roleId AND rp.status = 1 AND p.status = 1`,
    { replacements: { roleId }, type: QueryTypes.SELECT },
  ).catch(() => [] as { permission_key: string }[]);

  // Same precedence as buildAuthUser(): DB grants win, otherwise the built-in
  // module matrix for that role name/type applies.
  if (rows.length) return Array.from(new Set(rows.map((row) => row.permission_key)));
  return getModulePermissionsForRole({ roleId, roleName: role.name, roleType: role.type }).permissions;
}

// Privilege-escalation guard for "assign this role to an employee". Anyone
// with employees.manage / hr.update could otherwise hand out the CEO role (or
// give themselves a stronger one). CEO/full admins may assign any role;
// everyone else only a role whose permissions they already hold themselves.
export async function checkRoleAssignable(
  actor: AccessActor,
  roleId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (canAdministerAccess(actor)) return { ok: true };

  const target = await getEffectivePermissionsForRoleId(roleId);
  if (!target) return { ok: false, error: 'Selected role does not exist' };
  return canGrantPermissions(actor, target);
}
