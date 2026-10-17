import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { canManageMailboxes, ensureMailboxTables, getMailboxById, getMailboxForEmployee, toPublicMailbox } from '@/lib/mailboxes';

// A counselor sees only their own mailbox; the CEO can open any counselor's
// mailbox by passing ?mailboxId=.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  try {
    await ensureMailboxTables();
    const { searchParams } = new URL(request.url);
    const requestedId = Number(searchParams.get('mailboxId') || 0);
    const mailbox = requestedId && canManageMailboxes(auth) ? await getMailboxById(requestedId) : await getMailboxForEmployee(auth.id);
    if (!mailbox) return NextResponse.json({ success: true, mailbox: null, data: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } });

    const box = searchParams.get('box') === 'sent' ? 'out' : 'in';
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '25', 10)));
    const search = searchParams.get('q')?.trim();
    const leadId = Number(searchParams.get('leadId') || 0);

    const conditions = ['m.mailbox_id = :mailboxId', 'm.direction = :direction'];
    const replacements: Record<string, unknown> = { mailboxId: mailbox.id, direction: box, limit, offset: (page - 1) * limit };
    if (leadId) { conditions.push('m.lead_id = :leadId'); replacements.leadId = leadId; }
    if (search) {
      conditions.push('(m.subject LIKE :q OR m.from_address LIKE :q OR m.to_addresses LIKE :q OR m.from_name LIKE :q)');
      replacements.q = `%${search}%`;
    }
    const where = conditions.join(' AND ');
    const [rows, [{ total }], [{ unread }]] = await Promise.all([
      sequelize.query(
        `SELECT m.id, m.direction, m.from_address, m.from_name, m.to_addresses, m.subject,
                LEFT(COALESCE(m.body_text, ''), 160) AS preview, m.lead_id, m.is_read, m.status, m.error, m.message_date,
                CONCAT_WS(' ', l.fname, l.lname) AS lead_name
         FROM crm_mailbox_messages m
         LEFT JOIN crm_forum_leads l ON l.id = m.lead_id
         WHERE ${where}
         ORDER BY m.message_date DESC, m.id DESC
         LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT },
      ),
      sequelize.query<{ total: number }>(`SELECT COUNT(*) AS total FROM crm_mailbox_messages m WHERE ${where}`, { replacements, type: QueryTypes.SELECT }),
      sequelize.query<{ unread: number }>(
        "SELECT COUNT(*) AS unread FROM crm_mailbox_messages WHERE mailbox_id = :mailboxId AND direction = 'in' AND is_read = 0",
        { replacements: { mailboxId: mailbox.id }, type: QueryTypes.SELECT },
      ),
    ]);
    return NextResponse.json({
      success: true,
      mailbox: toPublicMailbox(mailbox),
      unread: Number(unread),
      data: rows,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (error) {
    console.error('Failed to list mail:', error);
    return NextResponse.json({ error: 'Failed to load mail' }, { status: 500 });
  }
}
