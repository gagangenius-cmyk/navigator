import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { getModulePermissionsForRole } from '@/lib/modulePermissions';

// A "full-admin" employee is one whose role resolves to the 'all' permission
// bucket (CEO, Director, Founder, Super Admin - see modulePermissions.ts).
// These accounts can never be deactivated or deleted through the ordinary
// Employee Data Sheet UI (the plain status toggle, bulk actions, or CEO
// delete) or the Operations access-control freeze — regardless of who is
// making the request, including another full-admin or the CEO themselves.
// This exists because crm_employee has no other durable protection: a plain
// UI mistake, a bulk action, or (previously) an unrelated seed script could
// silently deactivate the account that runs the whole CRM.
export const FULL_ADMIN_PROTECTED_MESSAGE =
  'This account holds full admin access (CEO/Director/Founder/Super Admin) and cannot be deactivated or deleted.';

export function isFullAdminRole(role: { name?: string | null; type?: string | null } | null | undefined): boolean {
  if (!role) return false;
  return getModulePermissionsForRole({ roleName: role.name, roleType: role.type }).permissions.includes('all');
}

// Bulk-friendly: resolves role name/type for every given employee id in one
// query and returns the subset that are full-admin protected.
export async function findFullAdminEmployeeIds(employeeIds: number[]): Promise<Set<number>> {
  if (!employeeIds.length) return new Set();
  const rows = await sequelize.query<{ id: number; name: string | null; type: string | null }>(
    `SELECT e.id, r.name, r.type
     FROM crm_employee e
     LEFT JOIN crm_role r ON r.id = e.role
     WHERE e.id IN (:employeeIds)`,
    { replacements: { employeeIds }, type: QueryTypes.SELECT }
  );
  return new Set(rows.filter((row) => isFullAdminRole(row)).map((row) => row.id));
}

export async function isFullAdminEmployeeId(employeeId: number): Promise<boolean> {
  return (await findFullAdminEmployeeIds([employeeId])).has(employeeId);
}
