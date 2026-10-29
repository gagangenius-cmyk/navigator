import { NextRequest, NextResponse } from 'next/server';
import { sequelize } from '@/lib/sequelize';
import { QueryTypes } from 'sequelize';
import { verifyToken } from '@/lib/auth';
import { isCeo } from '@/lib/roleChecks';
import { notifyMetaLeadQuality } from '@/lib/meta/lead-quality-feedback';
import { recordLeadAssignment, logLeadRemark } from '@/lib/leadRemarks';
import { assertLeadAccess } from '@/lib/leadAccess';
import { logAudit } from '@/lib/auditLog';

const ALLOWED_FIELDS = new Set([
  'status', 'priority', 'lead_quality', 'assignTo', 'branch', 'region',
  'appointment', 'followup', 'folowuptime', 'followupstat',
  'fname', 'mname', 'lname', 'email', 'phone', 'mobile',
  'country_interest', 'service_interest', 'market_source', 'lead_remark',
  'payTotal', 'discount', 'paidYet', 'payBalance',
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get('auth-token')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const currentUser = token ? verifyToken(token) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Authentication is required' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    const accessError = await assertLeadAccess(currentUser, id);
    if (accessError) return accessError;

    const [lead] = await sequelize.query(
      'SELECT * FROM crm_forum_leads WHERE id = ? LIMIT 1',
      { replacements: [id], type: QueryTypes.SELECT }
    );

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    return NextResponse.json(lead);
  } catch (error) {
    console.error('GET /api/leads-simple/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get('auth-token')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const currentUser = token ? verifyToken(token) : null;
    if (!currentUser) {
      return NextResponse.json({ error: 'Authentication is required' }, { status: 401 });
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
    const accessError = await assertLeadAccess(currentUser, id);
    if (accessError) return accessError;

    const body = await request.json();

    const [existing] = await sequelize.query<{
      payTotal: number | string | null;
      discount: number | string | null;
      paidYet: number | string | null;
      assignTo: number | string | null;
      status: string | null;
      lead_remark: string | null;
    }>(
      'SELECT payTotal, discount, paidYet, assignTo, status, lead_remark FROM crm_forum_leads WHERE id = ? LIMIT 1',
      { replacements: [id], type: QueryTypes.SELECT },
    );
    if (!existing) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (ALLOWED_FIELDS.has(key)) updates[key] = value;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const hasFinancialUpdate = ['payTotal', 'discount', 'paidYet'].some((field) => updates[field] !== undefined);
    if (hasFinancialUpdate) {
      const total = Number(updates.payTotal ?? existing.payTotal ?? 0);
      const discount = Number(updates.discount ?? existing.discount ?? 0);
      const paidYet = Number(updates.paidYet ?? existing.paidYet ?? 0);
      updates.payTotal = Math.max(total, 0);
      updates.discount = Math.max(discount, 0);
      updates.paidYet = Math.max(paidYet, 0);
      updates.payBalance = Math.max(total - discount - paidYet, 0);
    }

    const setClauses = Object.keys(updates).map(k => `\`${k}\` = ?`).join(', ');
    const values = [...Object.values(updates), id];

    await sequelize.query(
      `UPDATE crm_forum_leads SET ${setClauses} WHERE id = ?`,
      { replacements: values, type: QueryTypes.UPDATE }
    );

    // Money fields changed through this quick-edit path had no trail at all.
    if (hasFinancialUpdate) {
      void logAudit({
        entityType: 'lead_financials',
        entityId: id,
        action: 'update',
        summary: `Lead #${id} payment fields edited by ${currentUser.name || currentUser.id}`,
        actorId: currentUser.id,
        actorRole: currentUser.roleName || currentUser.type,
        before: { payTotal: existing.payTotal, discount: existing.discount, paidYet: existing.paidYet },
        after: { payTotal: updates.payTotal, discount: updates.discount, paidYet: updates.paidYet, payBalance: updates.payBalance },
      });
    }

    // Kanban drag-drop and quick edits change status/remark here; without a
    // crm_remarks entry they never showed up in the Today Activity tab.
    const actorRole = currentUser.roleName || currentUser.type;
    if (typeof updates.status === 'string' && updates.status !== existing.status) {
      await logLeadRemark({
        leadId: id,
        action: 'status_changed',
        remark: `Status changed from ${existing.status || 'New'} to ${updates.status} by ${currentUser.name || `Employee #${currentUser.id}`} (${actorRole})`,
        previousValue: existing.status || 'New',
        newValue: updates.status,
        actorId: currentUser.id,
        actorRole,
      });
    }
    const newRemark = typeof updates.lead_remark === 'string' ? updates.lead_remark.trim() : '';
    if (newRemark && newRemark !== String(existing.lead_remark || '').trim()) {
      await logLeadRemark({
        leadId: id,
        action: 'remark_added',
        remark: newRemark,
        actorId: currentUser.id,
        actorRole,
      });
    }

    // assignTo is an allowed quick-edit field, but this path never stamped the
    // assigned-since date, logged the change, or told the new owner.
    if (updates.assignTo !== undefined) {
      const oldAssignTo = existing.assignTo !== null && existing.assignTo !== undefined ? Number(existing.assignTo) : null;
      const rawNew = updates.assignTo;
      const newAssignTo = rawNew === null || rawNew === '' ? null : Number(rawNew);
      await recordLeadAssignment({
        leadId: id,
        oldAssignTo,
        newAssignTo: newAssignTo !== null && Number.isFinite(newAssignTo) ? newAssignTo : null,
        actorId: currentUser.id,
        actorRole: currentUser.roleName || currentUser.type,
      });
    }

    const [updated] = await sequelize.query(
      'SELECT id, fname, lname, status, priority, lead_quality, payTotal, discount, paidYet, payBalance FROM crm_forum_leads WHERE id = ? LIMIT 1',
      { replacements: [id], type: QueryTypes.SELECT }
    );

    // Fire-and-forget: reports the lead's Meta quality back to Meta's
    // Conversions API. No-op for leads not sourced from Meta Lead Ads.
    const metaLeadQuality = typeof body.metaLeadQuality === 'string' ? body.metaLeadQuality.trim() : '';
    if (metaLeadQuality) {
      notifyMetaLeadQuality(id, metaLeadQuality).catch((err) =>
        console.error(`[Meta Quality Feedback] Unhandled error for lead ${id}:`, err)
      );
    }

    return NextResponse.json({ success: true, lead: updated });
  } catch (error) {
    console.error('PUT /api/leads-simple/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const token = request.cookies.get('auth-token')?.value
      || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    const currentUser = token ? verifyToken(token) : null;
    if (!currentUser || !isCeo(currentUser)) {
      return NextResponse.json({ error: 'Only the CEO can delete records' }, { status: 403 });
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (!id) return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });

    const [lead] = await sequelize.query<{ id: number }>(
      'SELECT id FROM crm_forum_leads WHERE id = ? LIMIT 1',
      { replacements: [id], type: QueryTypes.SELECT },
    );
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    await sequelize.query('DELETE FROM crm_forum_leads WHERE id = ?', {
      replacements: [id], type: QueryTypes.DELETE,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/leads-simple/[id]:', error);
    return NextResponse.json({ error: 'Failed to delete lead' }, { status: 500 });
  }
}
