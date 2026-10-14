import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { CrmPermission } from '@/models/CrmPermission';
import { logAudit } from '@/lib/auditLog';
import { canAdministerAccess, PERMISSION_KEY_PATTERN } from '@/lib/accessAdmin';

const actorFields = (auth: { id?: number; roleName?: string; type?: string }) => ({
  actorId: auth.id ?? null,
  actorRole: auth.roleName || auth.type || null,
});

// Permission catalog: every key a role can be granted on the Role Access Matrix.
// A key only gates something once route/page code checks for it
// (requireAuth(request, ['my.key']) / canAccessAdminPath), so creating one here
// makes it assignable - it does not by itself protect anything.

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage', 'admin.access']);
  if (isAuthError(auth)) return auth;
  try {
    const permissions = await CrmPermission.findAll({
      order: [['module', 'ASC'], ['action', 'ASC']],
      raw: true,
    });
    return NextResponse.json({ data: permissions });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json({ error: 'Failed to fetch permissions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage']);
  if (isAuthError(auth)) return auth;
  if (!canAdministerAccess(auth)) {
    return NextResponse.json({ error: 'Only the CEO can create permissions' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const permissionKey = String(body.permission_key ?? '').trim().toLowerCase();
    const label = String(body.label ?? '').trim();
    const description = body.description ? String(body.description).trim().slice(0, 2000) : null;

    if (!PERMISSION_KEY_PATTERN.test(permissionKey) || permissionKey.length > 120) {
      return NextResponse.json(
        { error: 'Key must look like "module.action" (lowercase letters, digits, underscores), e.g. "visa.approve"' },
        { status: 400 },
      );
    }
    if (!label || label.length > 160) {
      return NextResponse.json({ error: 'A label is required (max 160 characters)' }, { status: 400 });
    }

    const existing = await CrmPermission.findOne({ where: { permission_key: permissionKey } });
    if (existing) {
      return NextResponse.json({ error: 'A permission with this key already exists' }, { status: 409 });
    }

    // module/action are derived from the key so they can never disagree with it:
    // "hr.team.attendance_leave" -> module "hr.team", action "attendance_leave".
    const segments = permissionKey.split('.');
    const action = segments.pop() as string;
    const moduleName = segments.join('.');
    if (moduleName.length > 80 || action.length > 40) {
      return NextResponse.json({ error: 'Module (max 80) or action (max 40) part of the key is too long' }, { status: 400 });
    }

    const created = await CrmPermission.create({
      permission_key: permissionKey,
      module: moduleName,
      action,
      label,
      description,
      status: 1,
    });

    await logAudit({
      entityType: 'permission',
      entityId: created.getDataValue('id'),
      action: 'permission_created',
      summary: `Permission "${permissionKey}" created`,
      ...actorFields(auth),
      after: { permission_key: permissionKey, label },
    });

    return NextResponse.json(created.get({ plain: true }), { status: 201 });
  } catch (error) {
    console.error('Error creating permission:', error);
    return NextResponse.json({ error: 'Failed to create permission' }, { status: 500 });
  }
}

// Only label/description/status are editable. The key itself is immutable:
// code checks it by string, so renaming one would silently orphan every route
// that references the old name.
export async function PUT(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage']);
  if (isAuthError(auth)) return auth;
  if (!canAdministerAccess(auth)) {
    return NextResponse.json({ error: 'Only the CEO can edit permissions' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const id = Number.parseInt(String(body.id ?? ''), 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Valid permission id is required' }, { status: 400 });
    }

    const permission = await CrmPermission.findByPk(id);
    if (!permission) {
      return NextResponse.json({ error: 'Permission not found' }, { status: 404 });
    }

    const changes: { label?: string; description?: string | null; status?: number } = {};
    if (body.label !== undefined) {
      const label = String(body.label).trim();
      if (!label || label.length > 160) {
        return NextResponse.json({ error: 'A label is required (max 160 characters)' }, { status: 400 });
      }
      changes.label = label;
    }
    if (body.description !== undefined) {
      changes.description = body.description ? String(body.description).trim().slice(0, 2000) : null;
    }
    if (body.status !== undefined) {
      const status = Number(body.status);
      if (status !== 0 && status !== 1) {
        return NextResponse.json({ error: 'status must be 0 or 1' }, { status: 400 });
      }
      changes.status = status;
    }

    const before = permission.get({ plain: true }) as unknown as Record<string, unknown>;
    await permission.update(changes);

    await logAudit({
      entityType: 'permission',
      entityId: id,
      action: 'permission_updated',
      summary: `Permission "${before.permission_key}" updated`,
      ...actorFields(auth),
      before: Object.fromEntries(Object.keys(changes).map((key) => [key, before[key]])),
      after: changes,
    });

    return NextResponse.json(permission.get({ plain: true }));
  } catch (error) {
    console.error('Error updating permission:', error);
    return NextResponse.json({ error: 'Failed to update permission' }, { status: 500 });
  }
}
