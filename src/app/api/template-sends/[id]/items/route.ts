import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB, sequelize } from '@/lib/sequelize';
import { loadTemplateSend } from '@/lib/templateSend/jobs';
import { canSendAsOwner, SKIP_REASON_LABELS } from '@/lib/templateSend/recipients';

let dbReady = false;
const ensureDb = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  // Spreadsheet formula injection: a cell starting with = + - @ would execute when the CSV is opened.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * GET /api/template-sends/:id/items?status=&page=&limit=&format=csv
 * The per-recipient report for one send: who, from which mailbox, what subject, outcome and why.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const sendId = Number(id);
    const job = await loadTemplateSend(sendId, auth, canSendAsOwner(auth));
    if (!job) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const csv = searchParams.get('format') === 'csv';
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = csv ? 5000 : Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));
    const where = status && ['queued', 'sending', 'sent', 'failed', 'skipped'].includes(status) ? 'AND i.status = :status' : '';

    const rows = await sequelize.query<Record<string, any>>(
      `SELECT i.id, i.lead_id, TRIM(CONCAT_WS(' ', l.fname, l.lname)) AS lead_name, i.to_email, i.status, i.skip_reason, i.attempts,
              i.last_error, i.subject, i.from_email, e.name AS sender_name, i.provider_message_id, i.sent_at
       FROM crm_template_send_items i
       LEFT JOIN crm_forum_leads l ON l.id = i.lead_id
       LEFT JOIN crm_employee e ON e.id = i.sender_employee_id
       WHERE i.send_id = :sendId ${where}
       ORDER BY i.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      { replacements: { sendId, status }, type: QueryTypes.SELECT },
    );
    const [{ total }] = await sequelize.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM crm_template_send_items i WHERE i.send_id = :sendId ${where}`,
      { replacements: { sendId, status }, type: QueryTypes.SELECT },
    );
    const items: Array<Record<string, any>> = rows.map((r) => ({ ...r, reason: r.skip_reason ? SKIP_REASON_LABELS[r.skip_reason] || r.skip_reason : r.last_error }));

    if (csv) {
      const header = ['Lead ID', 'Lead', 'To', 'Sender', 'From mailbox', 'Subject', 'Status', 'Reason / error', 'Attempts', 'Sent at (UTC)', 'Message ID'];
      const lines = [header.join(',')].concat(items.map((r) => [
        r.lead_id, r.lead_name, r.to_email, r.sender_name, r.from_email, r.subject, r.status, r.reason, r.attempts, r.sent_at, r.provider_message_id,
      ].map(csvCell).join(',')));
      return new NextResponse(lines.join('\r\n'), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="template-send-${sendId}.csv"` },
      });
    }
    return NextResponse.json({ success: true, items, total: Number(total), page, limit });
  } catch (error) {
    console.error('Failed to load template send items:', error);
    return NextResponse.json({ success: false, error: 'Failed to load recipients' }, { status: 500 });
  }
}
