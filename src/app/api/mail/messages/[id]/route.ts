import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { canManageMailboxes, ensureMailboxTables, getMailboxForEmployee } from '@/lib/mailboxes';

// Full conversation for a message: every message in the same thread (same
// mailbox) oldest-first, with attachment metadata. Opening your own inbox
// message marks the thread read; the CEO viewing someone else's mailbox does
// not change read state, and each such view is audit-logged.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  await ensureMailboxTables();
  const { id } = await params;
  const [message] = await sequelize.query<any>('SELECT id, mailbox_id, thread_key FROM crm_mailbox_messages WHERE id = :id', { replacements: { id: Number(id) }, type: QueryTypes.SELECT });
  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const own = await getMailboxForEmployee(auth.id);
  const isOwn = own?.id === message.mailbox_id;
  if (!isOwn && !canManageMailboxes(auth)) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const threadFilter = message.thread_key ? '(m.id = :id OR m.thread_key = :threadKey)' : 'm.id = :id';
  const thread = await sequelize.query<any>(
    `SELECT m.id, m.direction, m.folder, m.message_id, m.from_address, m.from_name, m.to_addresses, m.cc_addresses, m.subject,
            m.body_text, m.body_html, m.lead_id, m.is_read, m.is_starred, m.has_attachments, m.status, m.error, m.message_date,
            CONCAT_WS(' ', l.fname, l.lname) AS lead_name
     FROM crm_mailbox_messages m LEFT JOIN crm_forum_leads l ON l.id = m.lead_id
     WHERE m.mailbox_id = :mailboxId AND ${threadFilter}
     ORDER BY m.message_date ASC, m.id ASC`,
    { replacements: { id: message.id, mailboxId: message.mailbox_id, threadKey: message.thread_key }, type: QueryTypes.SELECT },
  );
  const ids = thread.map((t) => t.id);
  const attachments = ids.length
    ? await sequelize.query<{ id: number; message_id: number; filename: string; content_type: string | null; size: number }>(
        'SELECT id, message_id, filename, content_type, size FROM crm_mailbox_attachments WHERE message_id IN (:ids)',
        { replacements: { ids }, type: QueryTypes.SELECT },
      )
    : [];

  if (isOwn) {
    await sequelize.query("UPDATE crm_mailbox_messages SET is_read = 1 WHERE id IN (:ids) AND direction = 'in'", { replacements: { ids } });
  } else {
    void logAudit({ entityType: 'mailbox', entityId: message.mailbox_id, action: 'view_message', summary: `Opened message #${message.id}`, actorId: auth.id, actorRole: auth.roleName });
  }
  return NextResponse.json({
    success: true,
    readOnly: !isOwn,
    data: thread.map((t) => ({ ...t, attachments: attachments.filter((a) => a.message_id === t.id) })),
  });
}
