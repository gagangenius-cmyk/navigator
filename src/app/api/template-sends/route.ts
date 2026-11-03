import { NextRequest, NextResponse, after } from 'next/server';
import { QueryTypes } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB, sequelize } from '@/lib/sequelize';
import { ensureTemplateSendTables } from '@/lib/templateSend/schema';
import { createTemplateSend, TemplateSendError } from '@/lib/templateSend/jobs';
import { processTemplateSends } from '@/lib/templateSend/processor';
import { canSendAsOwner, type SenderMode } from '@/lib/templateSend/recipients';

export const maxDuration = 60;

let dbReady = false;
const ensureDb = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

/**
 * GET /api/template-sends?status=&from=&to=&page=  - the send report. Employees see their own sends;
 * managers (who can send as each counsellor) see everyone's.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    await ensureTemplateSendTables();
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = 25;
    const conditions: string[] = [];
    const replacements: Record<string, unknown> = {};
    if (!canSendAsOwner(auth)) { conditions.push('s.created_by = :uid'); replacements.uid = auth.id; }
    const status = searchParams.get('status');
    if (status && ['queued', 'scheduled', 'sending', 'completed', 'cancelled'].includes(status)) { conditions.push('s.status = :status'); replacements.status = status; }
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { conditions.push('s.created_at >= :from'); replacements.from = from; }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { conditions.push('s.created_at < DATE_ADD(:to, INTERVAL 1 DAY)'); replacements.to = to; }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sends = await sequelize.query(
      `SELECT s.id, s.template_name, s.sender_mode, s.status, s.scheduled_at_utc, s.total_selected, s.total_queued, s.total_skipped,
              s.created_at, s.completed_at, e.name AS created_by_name,
              SUM(i.status = 'sent') AS sent, SUM(i.status = 'failed') AS failed, SUM(i.status IN ('queued','sending')) AS pending
       FROM crm_template_sends s
       LEFT JOIN crm_employee e ON e.id = s.created_by
       LEFT JOIN crm_template_send_items i ON i.send_id = s.id
       ${where} GROUP BY s.id ORDER BY s.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      { replacements, type: QueryTypes.SELECT },
    );
    const [{ total }] = await sequelize.query<{ total: number }>(`SELECT COUNT(*) AS total FROM crm_template_sends s ${where}`, { replacements, type: QueryTypes.SELECT });
    return NextResponse.json({ success: true, sends, total: Number(total), page, limit });
  } catch (error) {
    console.error('Failed to list template sends:', error);
    return NextResponse.json({ success: false, error: 'Failed to load the report' }, { status: 500 });
  }
}

/**
 * POST /api/template-sends  { templateId, leadIds, senderMode, scheduledAt?, idempotencyKey }
 * Queues the emails and starts sending right away (unless scheduled); the per-minute cron
 * (/api/cron/template-sends) is the backstop that finishes anything left over.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const body = await request.json().catch(() => ({})) as {
      templateId?: number; leadIds?: number[]; senderMode?: SenderMode; scheduledAt?: string | null; idempotencyKey?: string;
    };
    const created = await createTemplateSend(auth, {
      templateId: Number(body.templateId),
      leadIds: Array.isArray(body.leadIds) ? body.leadIds : [],
      senderMode: body.senderMode === 'owner' ? 'owner' : 'me',
      scheduledAt: body.scheduledAt || null,
      idempotencyKey: String(body.idempotencyKey || ''),
    });
    if (!created.duplicate && !body.scheduledAt) {
      after(async () => {
        try { await processTemplateSends({ timeBudgetMs: 40_000 }); } catch (error) { console.error('Template send kick-off failed:', error); }
      });
    }
    return NextResponse.json({ success: true, ...created }, { status: created.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof TemplateSendError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('Template send failed:', error);
    return NextResponse.json({ success: false, error: 'Could not queue the send' }, { status: 500 });
  }
}
