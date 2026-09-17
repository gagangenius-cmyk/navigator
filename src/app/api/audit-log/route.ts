import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { ensureAuditLogTable } from '@/lib/auditLog';
import { captureError } from '@/lib/errorTracking';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

// Read-only by design - GET is the only handler this file exports. An audit
// trail that could be edited or deleted through its own API would defeat the
// point of having one; entries only ever come from logAudit() call sites.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['roles.manage', 'admin.access']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDB();
    await ensureAuditLogTable();

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page') || '1'));
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit') || '25')));
    const entityType = searchParams.get('entityType');
    const actorId = searchParams.get('actorId');
    const search = searchParams.get('search')?.trim();
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const replacements: Record<string, unknown> = { limit, offset };

    if (entityType) {
      conditions.push('a.entity_type = :entityType');
      replacements.entityType = entityType;
    }
    if (actorId) {
      conditions.push('a.actor_id = :actorId');
      replacements.actorId = Number(actorId);
    }
    if (search) {
      conditions.push('(a.summary LIKE :search OR a.action LIKE :search OR a.entity_id LIKE :search)');
      replacements.search = `%${search}%`;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [countRow] = await sequelize.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM crm_audit_log a ${where}`,
      { replacements, type: QueryTypes.SELECT }
    );

    const rows = await sequelize.query(
      `SELECT a.id, a.entity_type AS entityType, a.entity_id AS entityId, a.action, a.summary,
              a.actor_id AS actorId, COALESCE(e.name, a.actor_role, 'System') AS actorName,
              a.actor_role AS actorRole, a.before_value AS beforeValue, a.after_value AS afterValue,
              a.created_at AS createdAt
       FROM crm_audit_log a
       LEFT JOIN crm_employee e ON e.id = a.actor_id
       ${where}
       ORDER BY a.id DESC
       LIMIT :limit OFFSET :offset`,
      { replacements, type: QueryTypes.SELECT }
    );

    const total = Number(countRow?.total || 0);
    return NextResponse.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    captureError(error, { route: 'GET /api/audit-log' });
    return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 });
  }
}
