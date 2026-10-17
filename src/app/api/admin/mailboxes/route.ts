import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import {
  canManageMailboxes, ensureMailboxTables, encryptMailboxPassword, assertPublicHost, toPublicMailbox, type MailboxRow,
} from '@/lib/mailboxes';

// CEO-level mailbox administration: list every counselor's mailbox and
// connect a new one. Passwords are write-only - never returned.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  if (!canManageMailboxes(auth)) return NextResponse.json({ error: 'Only the CEO can manage mailboxes' }, { status: 403 });
  try {
    await ensureMailboxTables();
    const rows = await sequelize.query<MailboxRow & { employee_name: string | null; sent_today: number; unread: number }>(
      `SELECT m.*, e.name AS employee_name,
              (SELECT COUNT(*) FROM crm_mailbox_messages x WHERE x.mailbox_id = m.id AND x.direction = 'out' AND x.status = 'ok' AND x.created_at >= CURDATE()) AS sent_today,
              (SELECT COUNT(*) FROM crm_mailbox_messages x WHERE x.mailbox_id = m.id AND x.direction = 'in' AND x.is_read = 0) AS unread
       FROM crm_employee_mailboxes m
       LEFT JOIN crm_employee e ON e.id = m.employee_id
       ORDER BY e.name ASC`,
      { type: QueryTypes.SELECT },
    );
    const employees = await sequelize.query<{ id: number; name: string }>(
      `SELECT e.id, e.name FROM crm_employee e
       WHERE e.id NOT IN (SELECT employee_id FROM crm_employee_mailboxes)
       ORDER BY e.name ASC LIMIT 1000`,
      { type: QueryTypes.SELECT },
    );
    return NextResponse.json({ success: true, data: rows.map(toPublicMailbox), availableEmployees: employees });
  } catch (error) {
    console.error('Failed to list mailboxes:', error);
    return NextResponse.json({ error: 'Failed to list mailboxes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  if (!canManageMailboxes(auth)) return NextResponse.json({ error: 'Only the CEO can manage mailboxes' }, { status: 403 });
  try {
    const b = await request.json();
    const employeeId = Number(b.employeeId);
    const email = String(b.email || '').trim().toLowerCase();
    const smtpHost = String(b.smtpHost || '').trim();
    const username = String(b.username || email).trim();
    const password = String(b.password || '');
    if (!employeeId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !smtpHost || !password) {
      return NextResponse.json({ error: 'Counselor, email address, SMTP host and password are required' }, { status: 422 });
    }
    await assertPublicHost(smtpHost);
    const imapHost = String(b.imapHost || '').trim() || null;
    if (imapHost) await assertPublicHost(imapHost);
    await ensureMailboxTables();
    await sequelize.query(
      `INSERT INTO crm_employee_mailboxes
        (employee_id, email, display_name, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure, username, password_enc, signature, daily_limit, save_to_sent, created_by)
       VALUES (:employeeId, :email, :displayName, :smtpHost, :smtpPort, :smtpSecure, :imapHost, :imapPort, :imapSecure, :username, :passwordEnc, :signature, :dailyLimit, :saveToSent, :createdBy)`,
      {
        replacements: {
          employeeId, email, displayName: b.displayName || null, smtpHost,
          smtpPort: Number(b.smtpPort) || 587, smtpSecure: b.smtpSecure ? 1 : 0,
          imapHost, imapPort: Number(b.imapPort) || 993, imapSecure: b.imapSecure === false ? 0 : 1,
          username, passwordEnc: encryptMailboxPassword(password), signature: b.signature || null,
          dailyLimit: Math.max(1, Number(b.dailyLimit) || 200), saveToSent: b.saveToSent ? 1 : 0, createdBy: auth.id,
        },
      },
    );
    void logAudit({ entityType: 'mailbox', entityId: employeeId, action: 'create', summary: `Connected mailbox ${email}`, actorId: auth.id, actorRole: auth.roleName });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error: any) {
    if (error?.parent?.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: 'That counselor already has a mailbox, or the email address is already connected' }, { status: 409 });
    }
    console.error('Failed to create mailbox:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create mailbox' }, { status: 500 });
  }
}
