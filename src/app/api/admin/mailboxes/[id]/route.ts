import { NextRequest, NextResponse } from 'next/server';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { canManageMailboxes, getMailboxById, encryptMailboxPassword, assertPublicHost } from '@/lib/mailboxes';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  if (!canManageMailboxes(auth)) return NextResponse.json({ error: 'Only the CEO can manage mailboxes' }, { status: 403 });
  try {
    const { id } = await params;
    const mb = await getMailboxById(Number(id));
    if (!mb) return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
    const b = await request.json();
    const sets: string[] = [];
    const replacements: Record<string, unknown> = { id: mb.id };
    const set = (column: string, key: string, value: unknown) => { sets.push(`${column} = :${key}`); replacements[key] = value; };

    if (b.displayName !== undefined) set('display_name', 'displayName', b.displayName || null);
    if (b.signature !== undefined) set('signature', 'signature', b.signature || null);
    if (b.smtpHost !== undefined) { await assertPublicHost(String(b.smtpHost)); set('smtp_host', 'smtpHost', String(b.smtpHost).trim()); }
    if (b.smtpPort !== undefined) set('smtp_port', 'smtpPort', Number(b.smtpPort) || 587);
    if (b.smtpSecure !== undefined) set('smtp_secure', 'smtpSecure', b.smtpSecure ? 1 : 0);
    if (b.imapHost !== undefined) {
      const host = String(b.imapHost || '').trim() || null;
      if (host) await assertPublicHost(host);
      set('imap_host', 'imapHost', host);
    }
    if (b.imapPort !== undefined) set('imap_port', 'imapPort', Number(b.imapPort) || 993);
    if (b.imapSecure !== undefined) set('imap_secure', 'imapSecure', b.imapSecure ? 1 : 0);
    if (b.username !== undefined && String(b.username).trim()) set('username', 'username', String(b.username).trim());
    if (b.dailyLimit !== undefined) set('daily_limit', 'dailyLimit', Math.max(1, Number(b.dailyLimit) || 200));
    if (b.saveToSent !== undefined) set('save_to_sent', 'saveToSent', b.saveToSent ? 1 : 0);
    if (b.isActive !== undefined) set('is_active', 'isActive', b.isActive ? 1 : 0);
    // Blank password = keep the stored one.
    if (b.password) set('password_enc', 'passwordEnc', encryptMailboxPassword(String(b.password)));
    if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 422 });

    await sequelize.query(`UPDATE crm_employee_mailboxes SET ${sets.join(', ')} WHERE id = :id`, { replacements });
    // Never log the password value - only that it was rotated.
    void logAudit({
      entityType: 'mailbox', entityId: mb.employee_id, action: b.isActive === false ? 'disable' : 'update',
      summary: `Updated mailbox ${mb.email}${b.password ? ' (password rotated)' : ''}`, actorId: auth.id, actorRole: auth.roleName,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update mailbox:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update mailbox' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  if (!canManageMailboxes(auth)) return NextResponse.json({ error: 'Only the CEO can manage mailboxes' }, { status: 403 });
  const { id } = await params;
  const mb = await getMailboxById(Number(id));
  if (!mb) return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
  // Revoke = remove the credentials and the cached mail for this mailbox.
  await sequelize.query('DELETE FROM crm_mailbox_messages WHERE mailbox_id = :id', { replacements: { id: mb.id } });
  await sequelize.query('DELETE FROM crm_employee_mailboxes WHERE id = :id', { replacements: { id: mb.id } });
  void logAudit({ entityType: 'mailbox', entityId: mb.employee_id, action: 'delete', summary: `Revoked mailbox ${mb.email}`, actorId: auth.id, actorRole: auth.roleName });
  return NextResponse.json({ success: true });
}
