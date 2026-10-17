import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { canManageMailboxes, ensureMailboxTables, getMailboxForEmployee } from '@/lib/mailboxes';

// Authenticated attachment download. Always served as a forced download with
// nosniff - an emailed .html/.svg must never execute in the CRM's origin.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  await ensureMailboxTables();
  const { id } = await params;
  const [row] = await sequelize.query<{ filename: string; content_type: string | null; data: Buffer | null; mailbox_id: number }>(
    `SELECT a.filename, a.content_type, a.data, m.mailbox_id
     FROM crm_mailbox_attachments a JOIN crm_mailbox_messages m ON m.id = a.message_id
     WHERE a.id = :id`,
    { replacements: { id: Number(id) }, type: QueryTypes.SELECT },
  );
  if (!row || !row.data) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });

  const own = await getMailboxForEmployee(auth.id);
  if (own?.id !== row.mailbox_id) {
    if (!canManageMailboxes(auth)) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    void logAudit({ entityType: 'mailbox', entityId: row.mailbox_id, action: 'download_attachment', summary: `Downloaded ${row.filename}`, actorId: auth.id, actorRole: auth.roleName });
  }
  const safeName = row.filename.replace(/[^\w.\- ]+/g, '_');
  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
