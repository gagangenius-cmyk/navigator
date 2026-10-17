import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { canManageMailboxes, ensureMailboxTables, getMailboxForEmployee } from '@/lib/mailboxes';

// Full message body. Opening your own inbox message marks it read; the CEO
// viewing someone else's mailbox does not change its read state.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  await ensureMailboxTables();
  const { id } = await params;
  const [message] = await sequelize.query<any>(
    `SELECT m.*, CONCAT_WS(' ', l.fname, l.lname) AS lead_name
     FROM crm_mailbox_messages m LEFT JOIN crm_forum_leads l ON l.id = m.lead_id
     WHERE m.id = :id`,
    { replacements: { id: Number(id) }, type: QueryTypes.SELECT },
  );
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const own = await getMailboxForEmployee(auth.id);
  const isOwn = own?.id === message.mailbox_id;
  if (!isOwn && !canManageMailboxes(auth)) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  if (isOwn && message.direction === 'in' && !message.is_read) {
    await sequelize.query('UPDATE crm_mailbox_messages SET is_read = 1 WHERE id = :id', { replacements: { id: message.id } });
  }
  // The raw HTML of an incoming email is untrusted: only the text part is
  // returned for display (rendered as plain text by the UI).
  const { body_html, ...safe } = message;
  return NextResponse.json({ success: true, data: safe });
}
