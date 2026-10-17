import dns from 'dns/promises';
import net from 'net';
import { QueryTypes } from 'sequelize';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { sequelize } from './sequelize';
import { encryptSecret, decryptSecret } from './encryption';

// Per-counselor mailboxes (plain SMTP for sending, IMAP for the inbox) managed
// centrally by the CEO. Self-migrating like the rest of this codebase: each
// module CREATE TABLE IF NOT EXISTS's its own tables on first use.
//
// The mailbox password is stored AES-256-GCM encrypted (src/lib/encryption.ts)
// and is never returned to the browser - API responses only expose
// `hasPassword`. Messages are cached in crm_mailbox_messages and linked to a
// lead by matching the other party's address against crm_forum_leads.email.

let tablesReady: Promise<void> | null = null;

export const ensureMailboxTables = async () => {
  if (!tablesReady) {
    tablesReady = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_employee_mailboxes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          employee_id INT NOT NULL,
          email VARCHAR(255) NOT NULL,
          display_name VARCHAR(255) NULL,
          smtp_host VARCHAR(255) NOT NULL,
          smtp_port INT NOT NULL DEFAULT 587,
          smtp_secure TINYINT(1) NOT NULL DEFAULT 0,
          imap_host VARCHAR(255) NULL,
          imap_port INT NULL DEFAULT 993,
          imap_secure TINYINT(1) NOT NULL DEFAULT 1,
          username VARCHAR(255) NOT NULL,
          password_enc TEXT NOT NULL,
          signature TEXT NULL,
          daily_limit INT NOT NULL DEFAULT 200,
          is_active TINYINT(1) NOT NULL DEFAULT 1,
          last_test_at DATETIME NULL,
          last_error VARCHAR(500) NULL,
          last_sync_at DATETIME NULL,
          last_sync_uid INT NOT NULL DEFAULT 0,
          created_by INT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_mailbox_employee (employee_id),
          UNIQUE KEY uq_mailbox_email (email)
        )
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_mailbox_messages (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          mailbox_id INT NOT NULL,
          direction VARCHAR(8) NOT NULL,
          imap_uid INT NULL,
          message_id VARCHAR(500) NULL,
          in_reply_to VARCHAR(500) NULL,
          thread_key VARCHAR(500) NULL,
          from_address VARCHAR(255) NULL,
          from_name VARCHAR(255) NULL,
          to_addresses TEXT NULL,
          subject VARCHAR(998) NULL,
          body_text MEDIUMTEXT NULL,
          body_html MEDIUMTEXT NULL,
          lead_id INT NULL,
          is_read TINYINT(1) NOT NULL DEFAULT 0,
          status VARCHAR(16) NOT NULL DEFAULT 'ok',
          error VARCHAR(500) NULL,
          message_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_mailbox_uid (mailbox_id, direction, imap_uid),
          INDEX idx_mailbox_dir_date (mailbox_id, direction, message_date),
          INDEX idx_mailbox_thread (mailbox_id, thread_key),
          INDEX idx_mailbox_lead (lead_id)
        )
      `);
      // Enterprise upgrade: folders, stars, cc, attachments. Added with
      // column-exists checks because the tables may already exist in production.
      const addColumn = async (table: string, column: string, ddl: string) => {
        const [row] = await sequelize.query<{ n: number }>(
          'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column',
          { replacements: { table, column }, type: QueryTypes.SELECT },
        );
        if (Number(row.n) > 0) return false;
        await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
        return true;
      };
      const folderAdded = await addColumn('crm_mailbox_messages', 'folder', "VARCHAR(16) NOT NULL DEFAULT 'inbox'");
      if (folderAdded) {
        await sequelize.query("UPDATE crm_mailbox_messages SET folder = 'sent' WHERE direction = 'out'");
        await sequelize.query('ALTER TABLE crm_mailbox_messages ADD INDEX idx_mailbox_folder (mailbox_id, folder, message_date)');
      }
      await addColumn('crm_mailbox_messages', 'is_starred', 'TINYINT(1) NOT NULL DEFAULT 0');
      await addColumn('crm_mailbox_messages', 'has_attachments', 'TINYINT(1) NOT NULL DEFAULT 0');
      await addColumn('crm_mailbox_messages', 'cc_addresses', 'TEXT NULL');
      await addColumn('crm_mailbox_messages', 'trashed_at', 'DATETIME NULL');
      // Off by default: Gmail / Microsoft 365 already keep their own copy of
      // anything sent over SMTP, so appending would create duplicates.
      await addColumn('crm_employee_mailboxes', 'save_to_sent', 'TINYINT(1) NOT NULL DEFAULT 0');
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_mailbox_attachments (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          message_id BIGINT NOT NULL,
          filename VARCHAR(255) NOT NULL,
          content_type VARCHAR(150) NULL,
          size INT NOT NULL DEFAULT 0,
          data LONGBLOB NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_mailbox_att_message (message_id)
        )
      `);
    })().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  await tablesReady;
};

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // Vercel request-body ceiling is ~4.5MB
const MAX_SYNC_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const parseAddressList = (value: unknown): string[] =>
  String(value || '').split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean);

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface MailboxRow {
  id: number;
  employee_id: number;
  email: string;
  display_name: string | null;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: number;
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: number;
  username: string;
  password_enc: string;
  signature: string | null;
  save_to_sent: number;
  daily_limit: number;
  is_active: number;
  last_test_at: string | null;
  last_error: string | null;
  last_sync_at: string | null;
  last_sync_uid: number;
}

// Never let the encrypted password leave the server.
export const toPublicMailbox = (row: MailboxRow & { employee_name?: string | null; sent_today?: number }) => {
  const { password_enc, ...rest } = row;
  return { ...rest, has_password: Boolean(password_enc) };
};

// SSRF guard: the CEO supplies arbitrary hostnames that this server will open
// TCP connections to, so refuse anything resolving to loopback/private/link-
// local space (cloud metadata endpoint included). Set MAILBOX_ALLOW_PRIVATE_HOSTS=true
// only for an on-prem mail server on the same network.
const isPrivateAddress = (ip: string) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:');
};

export async function assertPublicHost(host: string) {
  if (process.env.MAILBOX_ALLOW_PRIVATE_HOSTS === 'true') return;
  const clean = host.trim();
  if (!clean || /[\s/]/.test(clean)) throw new Error('Invalid mail server host');
  const addresses = net.isIP(clean) ? [{ address: clean }] : await dns.lookup(clean, { all: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error(`Mail server host "${clean}" resolves to a private or unreachable address`);
  }
}

export async function getMailboxById(id: number): Promise<MailboxRow | null> {
  await ensureMailboxTables();
  const [row] = await sequelize.query<MailboxRow>('SELECT * FROM crm_employee_mailboxes WHERE id = :id', { replacements: { id }, type: QueryTypes.SELECT });
  return row || null;
}

export async function getMailboxForEmployee(employeeId: number): Promise<MailboxRow | null> {
  await ensureMailboxTables();
  const [row] = await sequelize.query<MailboxRow>('SELECT * FROM crm_employee_mailboxes WHERE employee_id = :employeeId', { replacements: { employeeId }, type: QueryTypes.SELECT });
  return row || null;
}

export const encryptMailboxPassword = (password: string) => encryptSecret(password);

const smtpTransport = (mb: MailboxRow) =>
  nodemailer.createTransport({
    host: mb.smtp_host,
    port: mb.smtp_port,
    secure: Boolean(mb.smtp_secure),
    requireTLS: !mb.smtp_secure,
    auth: { user: mb.username, pass: decryptSecret(mb.password_enc) },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

const imapClient = (mb: MailboxRow) =>
  new ImapFlow({
    host: mb.imap_host as string,
    port: mb.imap_port || 993,
    secure: Boolean(mb.imap_secure),
    auth: { user: mb.username, pass: decryptSecret(mb.password_enc) },
    logger: false,
    socketTimeout: 60_000,
  });

const shortError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 480);

// Verifies SMTP (and IMAP when configured) without sending anything.
export async function testMailbox(mb: MailboxRow): Promise<{ smtp: string; imap: string }> {
  const result = { smtp: 'ok', imap: mb.imap_host ? 'ok' : 'not configured' };
  await assertPublicHost(mb.smtp_host);
  try {
    await smtpTransport(mb).verify();
  } catch (error) {
    result.smtp = shortError(error);
  }
  if (mb.imap_host) {
    try {
      await assertPublicHost(mb.imap_host);
      const client = imapClient(mb);
      await client.connect();
      await client.logout();
    } catch (error) {
      result.imap = shortError(error);
    }
  }
  const failure = result.smtp !== 'ok' ? `SMTP: ${result.smtp}` : result.imap !== 'ok' && result.imap !== 'not configured' ? `IMAP: ${result.imap}` : null;
  await sequelize.query('UPDATE crm_employee_mailboxes SET last_test_at = NOW(), last_error = :error WHERE id = :id', { replacements: { id: mb.id, error: failure } });
  return result;
}

async function findLeadIdByEmail(address: string | null | undefined): Promise<number | null> {
  if (!address) return null;
  const [row] = await sequelize.query<{ id: number }>(
    'SELECT id FROM crm_forum_leads WHERE email = :address ORDER BY id DESC LIMIT 1',
    { replacements: { address: address.toLowerCase() }, type: QueryTypes.SELECT },
  );
  return row?.id ?? null;
}

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Copies a sent message into the mailbox's own Sent folder over IMAP (folder
// found via the Sent special-use flag, falling back to a "Sent"-like name).
async function appendToSentFolder(mb: MailboxRow, mailOptions: Record<string, unknown>) {
  await assertPublicHost(mb.imap_host as string);
  const rendered = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(mailOptions as Parameters<ReturnType<typeof nodemailer.createTransport>['sendMail']>[0]);
  const raw = (rendered as unknown as { message: Buffer }).message;
  const client = imapClient(mb);
  await client.connect();
  try {
    const folders = await client.list();
    const sent = folders.find((f) => f.specialUse === '\\Sent')?.path
      || folders.find((f) => /^(inbox\.)?sent( items| mail)?$/i.test(f.path))?.path
      || 'Sent';
    await client.append(sent, raw, ['\\Seen']);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export interface OutgoingAttachment { filename: string; content: Buffer; contentType?: string }

export async function sendFromMailbox(mb: MailboxRow, input: {
  to: string; cc?: string; bcc?: string; subject: string; body: string;
  inReplyTo?: string | null; leadId?: number | null; attachments?: OutgoingAttachment[];
}) {
  if (!mb.is_active) throw new Error('This mailbox is disabled');
  const toList = parseAddressList(input.to);
  const ccList = parseAddressList(input.cc);
  const bccList = parseAddressList(input.bcc);
  const everyone = [...toList, ...ccList, ...bccList];
  if (!toList.length) throw new Error('Add at least one recipient');
  if (everyone.length > 25) throw new Error('Too many recipients (maximum 25)');
  const bad = everyone.find((address) => !EMAIL_RE.test(address));
  if (bad) throw new Error(`"${bad}" is not a valid email address`);
  const attachments = input.attachments || [];
  if (attachments.reduce((sum, a) => sum + a.content.length, 0) > MAX_ATTACHMENT_BYTES) throw new Error('Attachments are too large (4 MB total limit)');

  const [{ sentToday }] = await sequelize.query<{ sentToday: number }>(
    "SELECT COUNT(*) AS sentToday FROM crm_mailbox_messages WHERE mailbox_id = :id AND direction = 'out' AND status = 'ok' AND created_at >= CURDATE()",
    { replacements: { id: mb.id }, type: QueryTypes.SELECT },
  );
  if (Number(sentToday) >= mb.daily_limit) throw new Error(`Daily send limit of ${mb.daily_limit} reached for this mailbox`);

  await assertPublicHost(mb.smtp_host);
  const text = mb.signature ? `${input.body}\n\n--\n${mb.signature}` : input.body;
  const html = `<div style="white-space:pre-wrap;font-family:Arial,sans-serif;font-size:14px">${escapeHtml(text)}</div>`;
  const leadId = input.leadId ?? (await findLeadIdByEmail(toList[0]));

  // Keep a whole conversation under one thread key: a reply inherits the
  // parent message's thread, not just the parent's own message-id.
  let threadKey: string | null = input.inReplyTo || null;
  if (input.inReplyTo) {
    const [parent] = await sequelize.query<{ thread_key: string | null }>(
      'SELECT thread_key FROM crm_mailbox_messages WHERE mailbox_id = :id AND message_id = :messageId LIMIT 1',
      { replacements: { id: mb.id, messageId: input.inReplyTo }, type: QueryTypes.SELECT },
    );
    if (parent?.thread_key) threadKey = parent.thread_key;
  }

  try {
    const mailOptions = {
      from: mb.display_name ? { name: mb.display_name, address: mb.email } : mb.email,
      to: toList,
      ...(ccList.length ? { cc: ccList } : {}),
      ...(bccList.length ? { bcc: bccList } : {}),
      subject: input.subject,
      text,
      html,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo, references: input.inReplyTo } : {}),
    };
    const info = await smtpTransport(mb).sendMail(mailOptions);
    if (mb.save_to_sent && mb.imap_host) {
      // Best-effort: the email is already delivered, so a failure to file the
      // copy must never turn a successful send into an error.
      await appendToSentFolder(mb, { ...mailOptions, messageId: info.messageId }).catch((error) => {
        console.error('Could not copy sent mail to the IMAP Sent folder:', error);
      });
    }
    const [rowId] = await sequelize.query(
      `INSERT INTO crm_mailbox_messages (mailbox_id, direction, folder, message_id, in_reply_to, thread_key, from_address, from_name, to_addresses, cc_addresses, subject, body_text, body_html, lead_id, is_read, has_attachments)
       VALUES (:mailboxId, 'out', 'sent', :messageId, :inReplyTo, :threadKey, :from, :fromName, :to, :cc, :subject, :text, :html, :leadId, 1, :hasAttachments)`,
      {
        type: QueryTypes.INSERT,
        replacements: {
          mailboxId: mb.id, messageId: info.messageId || null, inReplyTo: input.inReplyTo || null, threadKey: threadKey || info.messageId || null,
          from: mb.email, fromName: mb.display_name, to: toList.join(', '), cc: ccList.join(', ') || null,
          subject: input.subject.slice(0, 990), text, html, leadId, hasAttachments: attachments.length ? 1 : 0,
        },
      },
    ) as unknown as [number, number];
    for (const a of attachments) {
      await sequelize.query(
        'INSERT INTO crm_mailbox_attachments (message_id, filename, content_type, size, data) VALUES (:messageId, :filename, :contentType, :size, :data)',
        { replacements: { messageId: Number(rowId), filename: a.filename.slice(0, 250), contentType: a.contentType || null, size: a.content.length, data: a.content } },
      );
    }
    return { messageId: info.messageId };
  } catch (error) {
    const message = shortError(error);
    await sequelize.query(
      `INSERT INTO crm_mailbox_messages (mailbox_id, direction, folder, from_address, to_addresses, cc_addresses, subject, body_text, lead_id, is_read, status, error)
       VALUES (:mailboxId, 'out', 'sent', :from, :to, :cc, :subject, :text, :leadId, 1, 'failed', :error)`,
      { replacements: { mailboxId: mb.id, from: mb.email, to: toList.join(', '), cc: ccList.join(', ') || null, subject: input.subject.slice(0, 990), text, leadId, error: message } },
    );
    await sequelize.query('UPDATE crm_employee_mailboxes SET last_error = :error WHERE id = :id', { replacements: { id: mb.id, error: `SMTP send: ${message}` } });
    throw new Error(message);
  }
}

// Pulls new INBOX messages (UID > last_sync_uid). Capped per run so a huge
// mailbox is backfilled over several syncs instead of timing a request out.
export async function syncMailbox(mb: MailboxRow, maxMessages = 50): Promise<{ fetched: number }> {
  if (!mb.is_active || !mb.imap_host) return { fetched: 0 };
  await assertPublicHost(mb.imap_host);
  const client = imapClient(mb);
  let fetched = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      let lastUid = mb.last_sync_uid || 0;
      // First sync: start from the last 30 days rather than the whole history.
      const range = lastUid > 0 ? `${lastUid + 1}:*` : '1:*';
      const since = lastUid > 0 ? undefined : new Date(Date.now() - 30 * 86_400_000);
      const uids = (await client.search(since ? { since } : { uid: range }, { uid: true })) || [];
      const pending = uids.filter((uid) => uid > lastUid).sort((a, b) => a - b).slice(0, maxMessages);
      for (const uid of pending) {
        const message = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!message || !message.source) { lastUid = uid; continue; }
        const parsed = await simpleParser(message.source);
        const from = parsed.from?.value?.[0];
        const messageId = parsed.messageId || null;
        const inReplyTo = parsed.inReplyTo || null;
        const references = Array.isArray(parsed.references) ? parsed.references[0] : parsed.references;
        const leadId = await findLeadIdByEmail(from?.address);
        const ccText = (Array.isArray(parsed.cc) ? parsed.cc : parsed.cc ? [parsed.cc] : [])
          .flatMap((c) => c.value.map((v) => v.address)).filter(Boolean).join(', ') || null;
        const files = (parsed.attachments || []).filter((a) => a.content && a.content.length <= MAX_SYNC_ATTACHMENT_BYTES);
        const [insertedId, affected] = await sequelize.query(
          `INSERT IGNORE INTO crm_mailbox_messages (mailbox_id, direction, folder, imap_uid, message_id, in_reply_to, thread_key, from_address, from_name, to_addresses, cc_addresses, subject, body_text, body_html, lead_id, has_attachments, message_date)
           VALUES (:mailboxId, 'in', 'inbox', :uid, :messageId, :inReplyTo, :threadKey, :from, :fromName, :to, :cc, :subject, :text, :html, :leadId, :hasAttachments, :date)`,
          {
            type: QueryTypes.INSERT,
            replacements: {
              mailboxId: mb.id, uid, messageId, inReplyTo,
              threadKey: references || inReplyTo || messageId,
              from: from?.address?.toLowerCase() || null, fromName: from?.name || null,
              to: mb.email, cc: ccText, subject: (parsed.subject || '(no subject)').slice(0, 990),
              text: parsed.text || null, html: typeof parsed.html === 'string' ? parsed.html : null,
              leadId, hasAttachments: files.length ? 1 : 0, date: parsed.date || new Date(),
            },
          },
        ) as unknown as [number, number];
        if (Number(affected) > 0) {
          for (const file of files) {
            await sequelize.query(
              'INSERT INTO crm_mailbox_attachments (message_id, filename, content_type, size, data) VALUES (:messageId, :filename, :contentType, :size, :data)',
              { replacements: { messageId: Number(insertedId), filename: (file.filename || 'attachment').slice(0, 250), contentType: file.contentType || null, size: file.content.length, data: file.content } },
            );
          }
        }
        lastUid = uid;
        fetched += 1;
      }
      await sequelize.query('UPDATE crm_employee_mailboxes SET last_sync_uid = :uid, last_sync_at = NOW(), last_error = NULL WHERE id = :id', { replacements: { id: mb.id, uid: lastUid } });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (error) {
    await sequelize.query('UPDATE crm_employee_mailboxes SET last_error = :error WHERE id = :id', { replacements: { id: mb.id, error: `IMAP sync: ${shortError(error)}` } });
    try { await client.close(); } catch { /* connection already gone */ }
    throw error;
  }
  return { fetched };
}

// Permanently removes messages (and their attachments) that have sat in Trash
// longer than the retention period, so attachment blobs can't grow the
// database without bound. Archive and other folders are never touched.
export async function purgeOldTrash(days = Number(process.env.MAIL_TRASH_RETENTION_DAYS) || 30) {
  await ensureMailboxTables();
  const old = await sequelize.query<{ id: number }>(
    "SELECT id FROM crm_mailbox_messages WHERE folder = 'trash' AND trashed_at IS NOT NULL AND trashed_at < (NOW() - INTERVAL :days DAY) LIMIT 5000",
    { replacements: { days }, type: QueryTypes.SELECT },
  );
  const ids = old.map((r) => r.id);
  if (ids.length) {
    await sequelize.query('DELETE FROM crm_mailbox_attachments WHERE message_id IN (:ids)', { replacements: { ids } });
    await sequelize.query('DELETE FROM crm_mailbox_messages WHERE id IN (:ids)', { replacements: { ids } });
  }
  return { purged: ids.length, retentionDays: days };
}

export async function syncAllMailboxes() {
  await ensureMailboxTables();
  const rows = await sequelize.query<MailboxRow>('SELECT * FROM crm_employee_mailboxes WHERE is_active = 1 AND imap_host IS NOT NULL', { type: QueryTypes.SELECT });
  let ok = 0;
  let failed = 0;
  for (const mb of rows) {
    try { await syncMailbox(mb); ok += 1; } catch { failed += 1; }
  }
  return { mailboxes: rows.length, ok, failed };
}

// CEO (or anyone holding the explicit permission) manages every mailbox.
export const canManageMailboxes = (user: { roleName?: string | null; permissions?: string[] | null } | null | undefined) =>
  String(user?.roleName || '').trim().toLowerCase() === 'ceo'
  || Boolean(user?.permissions?.some((p) => p === 'all' || p === 'mailboxes.manage'));
