import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isCeo } from '@/lib/roleChecks';
import { CrmRole } from '@/models/CrmRole';
import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { logAudit } from '@/lib/auditLog';
import { canAdministerAccess } from '@/lib/accessAdmin';

const serializeRole = (role: any) => {
  const data = role.get({ plain: true });
  return {
    ...data,
    id: role.getDataValue('id') ?? data.id,
  };
};

const ROLE_FIELDS = ['name', 'type', 'hierarchy', 'department_id', 'status'] as const;

// Whitelist + coerce - the raw body used to be spread straight into the model
// (mass assignment), so unexpected columns could be written.
function parseRoleInput(body: Record<string, unknown>, partial: boolean): { data: Record<string, unknown> } | { error: string } {
  const out: Record<string, unknown> = {};
  for (const field of ROLE_FIELDS) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  if (!partial || out.name !== undefined) {
    const name = String(out.name ?? '').trim();
    if (!name || name.length > 100) return { error: 'Role name is required (max 100 characters)' };
    out.name = name;
  }
  if (!partial || out.type !== undefined) {
    const type = String(out.type ?? '').trim();
    if (!type || type.length > 100) return { error: 'Role type is required (max 100 characters)' };
    out.type = type;
  }
  for (const field of ['hierarchy', 'department_id'] as const) {
    if (out[field] === undefined) continue;
    const value = Number(out[field]);
    if (!Number.isInteger(value) || value < 1) return { error: `${field} must be a positive whole number` };
    out[field] = value;
  }
  if (out.status !== undefined) {
    const status = Number(out.status);
    if (status !== 0 && status !== 1) return { error: 'status must be 0 or 1' };
    out.status = status;
  }
  return { data: out };
}

const actorFields = (auth: { id?: number; roleName?: string; type?: string }) => ({
  actorId: auth.id ?? null,
  actorRole: auth.roleName || auth.type || null,
});

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage']);
  if (isAuthError(auth)) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';

    // Build where clause
    const whereClause: any = {};

    if (search) {
      whereClause[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { type: { [Op.like]: `%${search}%` } }
      ];
    }

    if (status !== '') {
      whereClause.status = parseInt(status);
    }

    // Get total count
    const total = await CrmRole.count({ where: whereClause });

    // Get roles with pagination
    const roles = await CrmRole.findAll({
      where: whereClause,
      limit,
      offset: (page - 1) * limit,
      order: [['hierarchy', 'ASC'], ['id', 'DESC']]
    });

    return NextResponse.json({
      data: roles.map(serializeRole),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching roles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch roles' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage']);
  if (isAuthError(auth)) return auth;
  if (!canAdministerAccess(auth)) {
    return NextResponse.json({ error: 'Only the CEO can create roles' }, { status: 403 });
  }
  try {
    const parsed = parseRoleInput(await request.json(), false);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const existing = await CrmRole.findOne({ where: { name: parsed.data.name as string } });
    if (existing) {
      return NextResponse.json({ error: 'A role with this name already exists' }, { status: 409 });
    }

    // New roles start with no permission grants. Until the CEO assigns some on
    // /admin/roles/permissions, login falls back to the built-in matrix for the
    // role's name/type (see buildAuthUser in src/lib/auth.ts).
    const newRole = await CrmRole.create({ status: 1, ...parsed.data } as never);
    const createdRole = await CrmRole.findOne({ where: { name: parsed.data.name as string } });
    const result = serializeRole(createdRole || newRole);

    await logAudit({
      entityType: 'role',
      entityId: result.id,
      action: 'role_created',
      summary: `Role "${parsed.data.name}" created`,
      ...actorFields(auth),
      after: parsed.data,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('Error creating role:', error);
    return NextResponse.json(
      { error: 'Failed to create role' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage']);
  if (isAuthError(auth)) return auth;
  if (!canAdministerAccess(auth)) {
    return NextResponse.json({ error: 'Only the CEO can edit roles' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const id = Number.parseInt(String(body.id ?? ''), 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Valid role id is required' }, { status: 400 });
    }

    const parsed = parseRoleInput(body, true);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const role = await CrmRole.findByPk(id);
    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      );
    }

    // Renaming or deactivating the CEO role would lock the CEO out of every
    // isCeo() check (matched on the literal role name) and of login itself.
    const isCeoRole = String(role.getDataValue('name')).trim().toLowerCase() === 'ceo';
    if (isCeoRole && (
      (parsed.data.name !== undefined && String(parsed.data.name).toLowerCase() !== 'ceo')
      || (parsed.data.status !== undefined && parsed.data.status !== 1)
    )) {
      return NextResponse.json({ error: 'The CEO role cannot be renamed or deactivated' }, { status: 403 });
    }

    const before = role.get({ plain: true }) as unknown as Record<string, unknown>;
    await role.update(parsed.data);

    await logAudit({
      entityType: 'role',
      entityId: id,
      action: 'role_updated',
      summary: `Role "${before.name}" (#${id}) updated`,
      ...actorFields(auth),
      before: Object.fromEntries(Object.keys(parsed.data).map((key) => [key, before[key]])),
      after: parsed.data,
    });

    return NextResponse.json(serializeRole(role));
  } catch (error) {
    console.error('Error updating role:', error);
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage']);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth)) {
    return NextResponse.json({ error: 'Only the CEO can delete records' }, { status: 403 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id') || '');

    const role = await CrmRole.findByPk(id);

    if (!role) {
      return NextResponse.json(
        { error: 'Role not found' },
        { status: 404 }
      );
    }

    if (String(role.getDataValue('name')).trim().toLowerCase() === 'ceo') {
      return NextResponse.json({ error: 'The CEO role cannot be deleted' }, { status: 403 });
    }

    // Deleting a role that employees still hold would leave them with a dangling
    // role id (login then silently degrades to the default access level).
    const [assigned] = await sequelize.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM crm_employee WHERE role = :id AND COALESCE(is_deleted, 0) = 0',
      { replacements: { id }, type: QueryTypes.SELECT },
    ).catch(() => [{ total: 0 }]);
    if (Number(assigned?.total || 0) > 0) {
      return NextResponse.json(
        { error: `${assigned.total} employee(s) still hold this role. Reassign them first, or deactivate the role instead.` },
        { status: 409 },
      );
    }

    await role.destroy();

    await logAudit({
      entityType: 'role',
      entityId: id,
      action: 'role_deleted',
      summary: `Role "${role.getDataValue('name')}" (#${id}) deleted`,
      ...actorFields(auth),
    });

    return NextResponse.json({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Error deleting role:', error);
    return NextResponse.json(
      { error: 'Failed to delete role' },
      { status: 500 }
    );
  }
}
