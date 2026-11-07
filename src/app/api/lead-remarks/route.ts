import { assertLeadAccess } from '@/lib/leadAccess';
import { getRecordVisibilityScope } from '@/lib/roleChecks';
import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { logLeadRemark } from '@/lib/leadRemarks';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

let dbInitialized = false;

const ensureDBConnection = async () => {
  if (!dbInitialized) {
    await connectDB();
    dbInitialized = true;
  }
};

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['leads.update']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDBConnection();

    const body = await request.json();
    const leadId = Number(body.leadId ?? body.lead_id ?? body.lead);
    const remark = String(body.remark ?? body.notes ?? '').trim();
    const now = new Date();

    if (!leadId && !remark) {
      return NextResponse.json(
        { error: 'Missing required fields: leadId, remark' },
        { status: 400 }
      );
    }
    if (!leadId) {
      return NextResponse.json(
        { error: 'leadId is required' },
        { status: 400 }
      );
    }
    if (!remark) {
      return NextResponse.json(
        { error: 'remark is required' },
        { status: 400 }
      );
    }

    // leads.update alone let a counselor add a remark to ANY lead id; apply the same lead scope as the
    // rest of the app (a counselor: only leads assigned to them).
    const accessError = await assertLeadAccess(auth, leadId);
    if (accessError) return accessError;

    // The author comes from the session. The body's employeeId was trusted (and defaulted to employee 1),
    // so a remark could be written in someone else's name; only a role that may see other people's leads
    // (Branch Manager / CEO ...) may still post on behalf of another employee.
    const postsAsSelfOnly = getRecordVisibilityScope(auth) === 'own';
    const requestedEmployeeId = Number(body.employeeId ?? body.emp ?? body.userId);
    const employeeId = postsAsSelfOnly || !requestedEmployeeId ? Number(auth.id) : requestedEmployeeId;

    const [recentDuplicate] = await sequelize.query<{ id: number }>(
      `SELECT id FROM crm_forum_leads_remarks
       WHERE \`lead\` = ? AND remark = ? AND emp = ?
         AND TIMESTAMP(\`date\`, created) >= (NOW() - INTERVAL 60 SECOND)
       LIMIT 1`,
      { replacements: [leadId, remark, employeeId], type: QueryTypes.SELECT }
    );
    if (recentDuplicate) {
      return NextResponse.json({ error: 'This remark was already added a moment ago.' }, { status: 409 });
    }

    const columns = await getTableColumns('crm_forum_leads_remarks');
    const insertColumns = ['`lead`', '`date`', 'remark', 'emp', 'created'];
    const placeholders = ['?', '?', '?', '?', '?'];
    const replacements: unknown[] = [
      leadId,
      now.toISOString().split('T')[0],
      remark,
      employeeId,
      now.toTimeString().split(' ')[0]
    ];

    if (columns.has('status')) {
      insertColumns.push('`status`');
      placeholders.push('?');
      replacements.push(1);
    }

    await sequelize.query(
      `INSERT INTO crm_forum_leads_remarks (${insertColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      { replacements, type: QueryTypes.INSERT }
    );

    await sequelize.query(
      `UPDATE crm_forum_leads
       SET lead_remark = ?, last_updated = ?, last_updtd_time = ?
       WHERE id = ?`,
      {
        replacements: [remark, now.toISOString().split('T')[0], now.toTimeString().split(' ')[0], leadId],
        type: QueryTypes.UPDATE
      }
    );

    const rows = await sequelize.query<{ id: number }>(
      'SELECT id FROM crm_forum_leads_remarks WHERE `lead` = ? AND remark = ? AND emp = ? ORDER BY id DESC LIMIT 1',
      { replacements: [leadId, remark, employeeId], type: QueryTypes.SELECT }
    );

    await logLeadRemark({
      leadId,
      action: 'remark_added',
      remark: `Remark added: ${remark}`,
      actorId: employeeId,
    });

    return NextResponse.json({
      success: true,
      remark: {
        id: Number(rows[0]?.id || 0),
        leadId,
        employeeId,
        remark,
        date: now.toISOString().split('T')[0]
      }
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating lead remark:', error);
    return NextResponse.json(
      { error: 'Failed to create lead remark' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = requireAuth(request, ['leads.update']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDBConnection();

    const body = await request.json();
    const id = Number(body.id);
    const remark = String(body.remark ?? body.notes ?? '').trim();

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (!remark) {
      return NextResponse.json({ error: 'remark is required' }, { status: 400 });
    }

    const [existing] = await sequelize.query<{ lead: number }>(
      'SELECT `lead` FROM crm_forum_leads_remarks WHERE id = ? LIMIT 1',
      { replacements: [id], type: QueryTypes.SELECT }
    );
    if (!existing) {
      return NextResponse.json({ error: 'Remark not found' }, { status: 404 });
    }
    // Editing a remark needs access to the lead it belongs to (any counselor could rewrite any remark by id).
    const remarkAccessError = await assertLeadAccess(auth, Number(existing.lead));
    if (remarkAccessError) return remarkAccessError;

    await sequelize.query(
      'UPDATE crm_forum_leads_remarks SET remark = ? WHERE id = ?',
      { replacements: [remark, id], type: QueryTypes.UPDATE }
    );

    // Keep the lead's denormalized "latest remark" column in sync, but only
    // when the edited row is still the most recent one for this lead - an
    // edit to an older remark must not overwrite a newer remark's text.
    const [latest] = await sequelize.query<{ id: number }>(
      'SELECT id FROM crm_forum_leads_remarks WHERE `lead` = ? ORDER BY id DESC LIMIT 1',
      { replacements: [existing.lead], type: QueryTypes.SELECT }
    );
    if (latest && Number(latest.id) === id) {
      const now = new Date();
      await sequelize.query(
        `UPDATE crm_forum_leads
         SET lead_remark = ?, last_updated = ?, last_updtd_time = ?
         WHERE id = ?`,
        {
          replacements: [remark, now.toISOString().split('T')[0], now.toTimeString().split(' ')[0], existing.lead],
          type: QueryTypes.UPDATE
        }
      );
    }

    const employeeId = Number(body.employeeId ?? body.emp ?? body.userId ?? auth.id ?? 1);
    await logLeadRemark({
      leadId: existing.lead,
      action: 'remark_edited',
      remark: `Remark updated: ${remark}`,
      actorId: employeeId,
    });

    return NextResponse.json({
      success: true,
      remark: { id, leadId: existing.lead, remark },
    });
  } catch (error) {
    console.error('Error updating lead remark:', error);
    return NextResponse.json(
      { error: 'Failed to update lead remark' },
      { status: 500 }
    );
  }
}

async function getTableColumns(table: string): Promise<Set<string>> {
  const rows = await sequelize.query<{ Field?: string }>(
    `SHOW COLUMNS FROM ${table}`,
    { type: QueryTypes.SELECT }
  );

  return new Set(rows.map(row => String(row.Field || '')));
}
