import { NextRequest, NextResponse } from 'next/server';
import { CrmRole } from '@/models/CrmRole';
import { CrmPermission } from '@/models/CrmPermission';
import { CrmRolePermission } from '@/models/CrmRolePermission';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { captureError } from '@/lib/errorTracking';
import { canAdministerAccess } from '@/lib/accessAdmin';
import { isCeo } from '@/lib/roleChecks';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request, ['roles.manage', 'admin.access']);
  if (isAuthError(auth)) return auth;
  try {
    const { id } = await params;
    const roleId = Number.parseInt(id, 10);
    if (!Number.isFinite(roleId)) {
      return NextResponse.json({ error: 'Valid role id is required' }, { status: 400 });
    }

    const role = await CrmRole.findByPk(roleId);
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    const allPermissions = await CrmPermission.findAll({
      where: { status: 1 },
      order: [['module', 'ASC'], ['action', 'ASC']],
    });

    const grants = await CrmRolePermission.findAll({ where: { role_id: roleId, status: 1 } });
    const grantedIds = new Set(grants.map((grant) => grant.getDataValue('permission_id')));

    const permissions = allPermissions.map((permission) => {
      const data = permission.get({ plain: true });
      return { ...data, granted: grantedIds.has(data.id) };
    });

    return NextResponse.json({
      role: role.get({ plain: true }),
      permissions,
    });
  } catch (error) {
    console.error('Error fetching role permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch role permissions' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request, ['roles.manage', 'admin.access']);
  if (isAuthError(auth)) return auth;
  // Reading the matrix is open to admin.access; changing it is not - that
  // permission is held by far more people than should be able to rewrite
  // (or escalate) role access.
  if (!canAdministerAccess(auth)) {
    return NextResponse.json({ error: 'Only the CEO can change role permissions' }, { status: 403 });
  }
  try {
    const { id } = await params;
    const roleId = Number.parseInt(id, 10);
    if (!Number.isFinite(roleId)) {
      return NextResponse.json({ error: 'Valid role id is required' }, { status: 400 });
    }

    const role = await CrmRole.findByPk(roleId);
    if (!role) {
      return NextResponse.json({ error: 'Role not found' }, { status: 404 });
    }

    const body = await request.json();
    const permissionKeys: string[] = Array.isArray(body.permissionKeys) ? body.permissionKeys : [];

    // Before-state for the audit entry below - the granted key set as it
    // stood immediately prior to this write.
    const previousGrants = await CrmRolePermission.findAll({ where: { role_id: roleId, status: 1 } });
    const previousPermissionIds = previousGrants.map((grant) => grant.getDataValue('permission_id'));
    const previousPermissions = previousPermissionIds.length
      ? await CrmPermission.findAll({ where: { id: previousPermissionIds } })
      : [];
    const previousKeys = previousPermissions.map((permission) => permission.getDataValue('permission_key')).sort();

    const permissions = await CrmPermission.findAll({ where: { permission_key: permissionKeys, status: 1 } });
    const permissionIds = permissions.map((permission) => permission.getDataValue('id'));

    // Silently dropping a key that isn't in the catalog would look like a
    // successful save while granting less than the CEO ticked.
    const foundKeys = new Set(permissions.map((permission) => permission.getDataValue('permission_key')));
    const unknownKeys = permissionKeys.filter((key) => !foundKeys.has(key));
    if (unknownKeys.length) {
      return NextResponse.json({ error: `Unknown permission(s): ${unknownKeys.join(', ')}` }, { status: 400 });
    }

    // The CEO role must always keep roles.manage, otherwise nobody can undo a
    // mistaken edit from the UI.
    if (isCeo({ roleName: role.getDataValue('name') }) && !foundKeys.has('roles.manage')) {
      return NextResponse.json({ error: 'The CEO role must keep the roles.manage permission' }, { status: 400 });
    }

    // One transaction: a failure part-way must not leave the role with every
    // grant switched off and only some re-enabled.
    await sequelize.transaction(async (transaction) => {
      await CrmRolePermission.update({ status: 0 }, { where: { role_id: roleId }, transaction });

      for (const permissionId of permissionIds) {
        await sequelize.query(
          `INSERT INTO crm_role_permissions (role_id, permission_id, status)
           VALUES (:roleId, :permissionId, 1)
           ON DUPLICATE KEY UPDATE status = 1, updated_at = CURRENT_TIMESTAMP`,
          { replacements: { roleId, permissionId }, transaction },
        );
      }
    });

    const newKeys = permissions.map((permission) => permission.getDataValue('permission_key')).sort();
    await logAudit({
      entityType: 'role_permissions',
      entityId: roleId,
      action: 'role_permissions_updated',
      summary: `Permissions updated for role "${role.getDataValue('name')}" (#${roleId})`,
      actorId: (auth as { id?: number }).id ?? null,
      actorRole: (auth as { roleName?: string; type?: string }).roleName || (auth as { type?: string }).type || null,
      before: { permissionKeys: previousKeys },
      after: { permissionKeys: newKeys },
    });

    return NextResponse.json({ roleId, grantedCount: permissionIds.length });
  } catch (error) {
    console.error('Error updating role permissions:', error);
    captureError(error, { route: 'PUT /api/admin/roles/[id]/permissions' });
    return NextResponse.json({ error: 'Failed to update role permissions' }, { status: 500 });
  }
}
