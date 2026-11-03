import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB, sequelize } from '@/lib/sequelize';
import { loadTemplateSend } from '@/lib/templateSend/jobs';
import { canSendAsOwner, SKIP_REASON_LABELS } from '@/lib/templateSend/recipients';

let dbReady = false;
const ensureDb = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

/** GET /api/template-sends/:id - progress of one send, plus the failed/skipped items. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const job = await loadTemplateSend(Number(id), auth, canSendAsOwner(auth));
    if (!job) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    const problems = await sequelize.query<{ lead_id: number; to_email: string | null; status: string; skip_reason: string | null; last_error: string | null }>(
      `SELECT lead_id, to_email, status, skip_reason, last_error FROM crm_template_send_items
       WHERE send_id = :id AND status IN ('failed', 'skipped') ORDER BY id LIMIT 100`,
      { replacements: { id: Number(id) }, type: QueryTypes.SELECT },
    );
    const events = await sequelize.query(
      `SELECT ev.id, ev.item_id, ev.event, ev.detail, ev.created_at, a.name AS actor_name
       FROM crm_template_send_events ev LEFT JOIN crm_employee a ON a.id = ev.actor_id
       WHERE ev.send_id = :id ORDER BY ev.id DESC LIMIT 300`,
      { replacements: { id: Number(id) }, type: QueryTypes.SELECT },
    );
    return NextResponse.json({
      success: true,
      job,
      events,
      problems: problems.map((p) => ({ ...p, reason: p.skip_reason ? SKIP_REASON_LABELS[p.skip_reason] || p.skip_reason : p.last_error })),
    });
  } catch (error) {
    console.error('Failed to load template send:', error);
    return NextResponse.json({ success: false, error: 'Failed to load the send' }, { status: 500 });
  }
}
