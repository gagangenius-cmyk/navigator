import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { canManageMailboxes, ensureMailboxTables, getMailboxById, getMailboxForEmployee, toPublicMailbox } from '@/lib/mailboxes';

const FOLDER_SQL: Record<string, string> = {
  inbox: "m.folder = 'inbox'",
  sent: "m.folder = 'sent'",
  starred: "m.is_starred = 1 AND m.folder <> 'trash'",
  archive: "m.folder = 'archive'",
  trash: "m.folder = 'trash'",
};

// A counselor sees only their own mailbox; the CEO (mailboxes.manage) can open
// any counselor's mailbox read-only by passing ?mailboxId=.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  try {
    await ensureMailboxTables();
    const { searchParams } = new URL(request.url);
    const manager = canManageMailboxes(auth);
    const own = await getMailboxForEmployee(auth.id);
    const requestedId = Number(searchParams.get('mailboxId') || 0);
    const mailbox = requestedId && manager ? await getMailboxById(requestedId) : own;

    const allMailboxes = manager
      ? await sequelize.query<{ id: number; email: string; employee_name: string | null; unread: number }>(
          `SELECT m.id, m.email, e.name AS employee_name,
                  (SELECT COUNT(*) FROM crm_mailbox_messages x WHERE x.mailbox_id = m.id AND x.folder = 'inbox' AND x.is_read = 0) AS unread
           FROM crm_employee_mailboxes m LEFT JOIN crm_employee e ON e.id = m.employee_id ORDER BY e.name ASC`,
          { type: QueryTypes.SELECT },
        )
      : [];

    if (!mailbox) {
      return NextResponse.json({ success: true, mailbox: null, canManageAll: manager, mailboxes: allMailboxes, data: [], counts: {}, pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } });
    }
    const readOnly = mailbox.id !== own?.id;

    const folder = FOLDER_SQL[searchParams.get('folder') || ''] ? (searchParams.get('folder') as string) : 'inbox';
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '25', 10)));
    const search = searchParams.get('q')?.trim();
    const leadId = Number(searchParams.get('leadId') || 0);

    const conditions = ['m.mailbox_id = :mailboxId', FOLDER_SQL[folder]];
    const replacements: Record<string, unknown> = { mailboxId: mailbox.id, limit, offset: (page - 1) * limit };
    if (leadId) { conditions.push('m.lead_id = :leadId'); replacements.leadId = leadId; }
    if (searchParams.get('unread') === '1') conditions.push('m.is_read = 0');
    if (searchParams.get('attachments') === '1') conditions.push('m.has_attachments = 1');
    if (search) {
      conditions.push('(m.subject LIKE :q OR m.from_address LIKE :q OR m.to_addresses LIKE :q OR m.from_name LIKE :q OR m.body_text LIKE :q)');
      replacements.q = `%${search}%`;
    }
    const where = conditions.join(' AND ');

    const [rows, [{ total }], counts] = await Promise.all([
      sequelize.query(
        `SELECT m.id, m.direction, m.folder, m.from_address, m.from_name, m.to_addresses, m.subject,
                LEFT(COALESCE(m.body_text, ''), 160) AS preview, m.lead_id, m.is_read, m.is_starred, m.has_attachments,
                m.status, m.error, m.message_date, m.thread_key,
                (SELECT COUNT(*) FROM crm_mailbox_messages t WHERE t.mailbox_id = m.mailbox_id AND t.thread_key = m.thread_key AND m.thread_key IS NOT NULL) AS thread_count,
                CONCAT_WS(' ', l.fname, l.lname) AS lead_name
         FROM crm_mailbox_messages m
         LEFT JOIN crm_forum_leads l ON l.id = m.lead_id
         WHERE ${where}
         ORDER BY m.message_date DESC, m.id DESC
         LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT },
      ),
      sequelize.query<{ total: number }>(`SELECT COUNT(*) AS total FROM crm_mailbox_messages m WHERE ${where}`, { replacements, type: QueryTypes.SELECT }),
      sequelize.query<{ inbox_unread: number; starred: number; trash: number; archive: number }>(
        `SELECT SUM(folder = 'inbox' AND is_read = 0) AS inbox_unread,
                SUM(is_starred = 1 AND folder <> 'trash') AS starred,
                SUM(folder = 'trash') AS trash,
                SUM(folder = 'archive') AS archive
         FROM crm_mailbox_messages WHERE mailbox_id = :mailboxId`,
        { replacements: { mailboxId: mailbox.id }, type: QueryTypes.SELECT },
      ),
    ]);

    if (readOnly) {
      void logAudit({ entityType: 'mailbox', entityId: mailbox.employee_id, action: 'view_mailbox', summary: `Viewed ${mailbox.email} (${folder})`, actorId: auth.id, actorRole: auth.roleName });
    }

    return NextResponse.json({
      success: true,
      mailbox: toPublicMailbox(mailbox),
      readOnly,
      canManageAll: manager,
      mailboxes: allMailboxes,
      counts: {
        inbox_unread: Number(counts[0]?.inbox_unread || 0),
        starred: Number(counts[0]?.starred || 0),
        trash: Number(counts[0]?.trash || 0),
        archive: Number(counts[0]?.archive || 0),
      },
      data: rows,
      pagination: { page, limit, total: Number(total), totalPages: Math.ceil(Number(total) / limit) },
    });
  } catch (error) {
    console.error('Failed to list mail:', error);
    return NextResponse.json({ error: 'Failed to load mail' }, { status: 500 });
  }
}

const ACTIONS: Record<string, string> = {
  read: 'is_read = 1',
  unread: 'is_read = 0',
  star: 'is_starred = 1',
  unstar: 'is_starred = 0',
  archive: "folder = 'archive'",
  trash: "folder = 'trash', trashed_at = NOW()",
  restore: "folder = IF(direction = 'in', 'inbox', 'sent')",
};

// Bulk actions on the caller's OWN mailbox only (the CEO's view is read-only).
export async function PATCH(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  try {
    const own = await getMailboxForEmployee(auth.id);
    if (!own) return NextResponse.json({ error: 'No mailbox is connected to your account' }, { status: 409 });
    const body = await request.json();
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).filter(Boolean).slice(0, 200);
    const action = String(body.action || '');
    if (!ids.length) return NextResponse.json({ error: 'Select at least one message' }, { status: 422 });

    if (action === 'purge') {
      const targets = await sequelize.query<{ id: number }>(
        "SELECT id FROM crm_mailbox_messages WHERE mailbox_id = :mailboxId AND folder = 'trash' AND id IN (:ids)",
        { replacements: { mailboxId: own.id, ids }, type: QueryTypes.SELECT },
      );
      const targetIds = targets.map((t) => t.id);
      if (targetIds.length) {
        await sequelize.query('DELETE FROM crm_mailbox_attachments WHERE message_id IN (:ids)', { replacements: { ids: targetIds } });
        await sequelize.query('DELETE FROM crm_mailbox_messages WHERE id IN (:ids)', { replacements: { ids: targetIds } });
      }
      return NextResponse.json({ success: true, affected: targetIds.length });
    }
    if (action === 'link' || action === 'unlink') {
      const leadId = action === 'link' ? Number(body.leadId) : null;
      if (action === 'link' && !leadId) return NextResponse.json({ error: 'Choose a lead to link' }, { status: 422 });
      await sequelize.query('UPDATE crm_mailbox_messages SET lead_id = :leadId WHERE mailbox_id = :mailboxId AND id IN (:ids)', { replacements: { leadId, mailboxId: own.id, ids } });
      return NextResponse.json({ success: true });
    }
    const assignment = ACTIONS[action];
    if (!assignment) return NextResponse.json({ error: 'Unknown action' }, { status: 422 });
    await sequelize.query(`UPDATE crm_mailbox_messages SET ${assignment} WHERE mailbox_id = :mailboxId AND id IN (:ids)`, { replacements: { mailboxId: own.id, ids } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Mail bulk action failed:', error);
    return NextResponse.json({ error: 'Action failed' }, { status: 500 });
  }
}
