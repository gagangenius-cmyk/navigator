import crypto from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { CrmMessageTemplateVersions } from '@/models';
import { broadcastDailyLimit, broadcastSentToday, ensureMailboxTables, getMailboxById, sendFromMailbox } from '@/lib/mailboxes';
import { buildSendValues } from './values';
import { logSendEvent } from './events';
import { suppressionAddressHash } from '@/lib/broadcastDedupeKeys';
import { logLeadRemark } from '@/lib/leadRemarks';
import { renderEmail, type EmailVersionContent } from './render';
import { ensureTemplateSendTables } from './schema';

// One cron tick: release due scheduled jobs, then send queued items one at a time.
// Each item is claimed atomically (so overlapping ticks cannot double-send), re-validated
// at send time (things change between confirm and send), and retried with backoff.
const MAX_ATTEMPTS = 3;
const SPACING_MS = () => Math.max(0, Number(process.env.TEMPLATE_SEND_SPACING_MS) || 1000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const affectedOf = (meta: unknown) => Number((meta as { affectedRows?: number })?.affectedRows ?? meta ?? 0);

/** The mailbox's daily broadcast cap is a temporary, self-resolving condition: wait, don't fail. */
class ThrottledError extends Error {}
/** Will not succeed on retry (bad recipient, disabled mailbox...). */
class PermanentError extends Error {}

type ItemOutcome = 'sent' | 'failed' | 'skipped' | 'requeued' | 'raced';

async function processItem(itemId: number): Promise<ItemOutcome> {
  const token = crypto.randomUUID();
  const [, claimed] = await sequelize.query(
    `UPDATE crm_template_send_items SET status = 'sending', lock_token = :token, locked_at = NOW(), attempts = attempts + 1
     WHERE id = :id AND status = 'queued'`,
    { replacements: { id: itemId, token }, type: QueryTypes.UPDATE },
  );
  if (affectedOf(claimed) < 1) return 'raced';

  const [item] = await sequelize.query<Record<string, any>>(
    `SELECT i.*, s.template_id, s.template_version_id, s.template_name, s.created_by, s.status AS job_status
     FROM crm_template_send_items i JOIN crm_template_sends s ON s.id = i.send_id WHERE i.id = :id`,
    { replacements: { id: itemId }, type: QueryTypes.SELECT },
  );
  await sequelize.query(`UPDATE crm_template_sends SET status = 'sending' WHERE id = :id AND status = 'queued'`, { replacements: { id: item.send_id }, type: QueryTypes.UPDATE });

  const finish = (status: 'sent' | 'failed' | 'skipped' | 'queued', fields: Record<string, unknown> = {}) => sequelize.query(
    `UPDATE crm_template_send_items SET status = :status, lock_token = NULL, skip_reason = :skipReason, last_error = :error,
       next_attempt_at = DATE_ADD(NOW(), INTERVAL :delay MINUTE), sent_at = :sentAt, provider_message_id = :providerId,
       attempts = attempts - :refund, subject = COALESCE(:subject, subject), from_email = COALESCE(:fromEmail, from_email)
     WHERE id = :id AND lock_token = :token`,
    { replacements: { id: itemId, token, status, skipReason: null, error: null, delay: 0, sentAt: null, providerId: null, refund: 0, subject: null, fromEmail: null, ...fields }, type: QueryTypes.UPDATE },
  );
  const sendId = Number(item.send_id);

  try {
    // Cancelled while queued.
    if (item.job_status === 'cancelled') { await finish('skipped', { skipReason: 'cancelled' }); await logSendEvent(sendId, 'skipped', { reason: 'cancelled' }, { itemId }); return 'skipped'; }

    // Re-checked at send time.
    const email = String(item.to_email || '').trim().toLowerCase();
    const [suppressed] = await sequelize.query(
      "SELECT id FROM crm_message_suppressions WHERE channel = 'email' AND address_hash = :hash LIMIT 1",
      { replacements: { hash: suppressionAddressHash(email) }, type: QueryTypes.SELECT },
    );
    const [optedOut] = await sequelize.query(
      "SELECT id FROM crm_contact_channel_consents WHERE channel = 'email' AND consent_state = 'opted_out' AND lead_id = :leadId LIMIT 1",
      { replacements: { leadId: item.lead_id }, type: QueryTypes.SELECT },
    );
    if (suppressed || optedOut) {
      const reason = suppressed ? 'suppressed' : 'opted_out';
      await finish('skipped', { skipReason: reason });
      await logSendEvent(sendId, 'skipped', { reason, leadId: item.lead_id }, { itemId });
      return 'skipped';
    }

    const [sender] = await sequelize.query<{ status: number }>('SELECT status FROM crm_employee WHERE id = :id LIMIT 1', { replacements: { id: item.sender_employee_id || 0 }, type: QueryTypes.SELECT });
    if (!sender || Number(sender.status) !== 1) { await finish('skipped', { skipReason: 'sender_inactive' }); await logSendEvent(sendId, 'skipped', { reason: 'sender_inactive', leadId: item.lead_id }, { itemId }); return 'skipped'; }

    await ensureMailboxTables();
    const mailbox = item.mailbox_id ? await getMailboxById(Number(item.mailbox_id)) : null;
    if (!mailbox || !mailbox.is_active) throw new PermanentError('The sender mailbox is missing or disabled');

    const version = await CrmMessageTemplateVersions.findByPk(Number(item.template_version_id));
    if (!version) { await finish('skipped', { skipReason: 'template_missing' }); await logSendEvent(sendId, 'skipped', { reason: 'template_missing' }, { itemId }); return 'skipped'; }

    const [lead] = await sequelize.query<{ email: string | null }>('SELECT email FROM crm_forum_leads WHERE id = :id LIMIT 1', { replacements: { id: item.lead_id }, type: QueryTypes.SELECT });
    if (!lead) { await finish('skipped', { skipReason: 'not_found' }); await logSendEvent(sendId, 'skipped', { reason: 'not_found', leadId: item.lead_id }, { itemId }); return 'skipped'; }
    // The lead's email may have been corrected since the job was created.
    const to = String(lead.email || email).trim();

    const values = await buildSendValues(Number(item.lead_id), Number(item.sender_employee_id));
    const rendered = renderEmail({ components: version.components as EmailVersionContent['components'], exportHtml: version.exportHtml, exportText: version.exportText }, values);
    if (!rendered.subject) throw new PermanentError('The template has no subject');

    if ((await broadcastSentToday(mailbox.id)) >= broadcastDailyLimit()) {
      throw new ThrottledError(`Daily limit of ${broadcastDailyLimit()} template emails reached for ${mailbox.email}`);
    }

    let result: { messageId?: string };
    try {
      result = await sendFromMailbox(mailbox, { to, subject: rendered.subject, body: rendered.text, html: rendered.html, leadId: Number(item.lead_id), source: 'broadcast' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Send failed';
      // Address problems and a disabled mailbox will not fix themselves.
      if (/not a valid email|Add at least one recipient|disabled|rejected|550|553|user unknown|no such user/i.test(message)) throw new PermanentError(message);
      throw error;
    }

    await finish('sent', { sentAt: new Date().toISOString().slice(0, 19).replace('T', ' '), providerId: result.messageId ?? null, subject: rendered.subject.slice(0, 990), fromEmail: mailbox.email });
    await logSendEvent(sendId, 'sent', { to, from: mailbox.email, subject: rendered.subject, messageId: result.messageId ?? null, emptyVariables: rendered.missing }, { itemId });
    await logLeadRemark({
      leadId: Number(item.lead_id), action: 'email_sent', actorId: Number(item.created_by), actorRole: 'template_send',
      remark: `Email "${item.template_name}" sent to ${to} from ${mailbox.email}: ${rendered.subject}`,
    });
    return 'sent';
  } catch (error) {
    const message = (error instanceof Error ? error.message : 'Send failed').slice(0, 2000);
    if (error instanceof ThrottledError) {
      // Try again in an hour without using up an attempt.
      await finish('queued', { error: message, delay: 60, refund: 1 });
      await logSendEvent(sendId, 'throttled', message, { itemId });
      return 'requeued';
    }
    const final = error instanceof PermanentError || Number(item.attempts) >= MAX_ATTEMPTS;
    await finish(final ? 'failed' : 'queued', { error: message, delay: final ? 0 : 5 * 2 ** Number(item.attempts) });
    await logSendEvent(sendId, final ? 'failed' : 'retry_scheduled', { error: message, attempt: Number(item.attempts) }, { itemId });
    return final ? 'failed' : 'requeued';
  }
}

export async function processTemplateSends({ timeBudgetMs = 45_000 }: { timeBudgetMs?: number } = {}) {
  await ensureTemplateSendTables();
  const started = Date.now();

  // Scheduled jobs whose time has come (scheduled_at_utc is UTC).
  const due = await sequelize.query<{ id: number }>(`SELECT id FROM crm_template_sends WHERE status = 'scheduled' AND scheduled_at_utc <= UTC_TIMESTAMP()`, { type: QueryTypes.SELECT });
  if (due.length) {
    await sequelize.query(`UPDATE crm_template_sends SET status = 'queued' WHERE status = 'scheduled' AND scheduled_at_utc <= UTC_TIMESTAMP()`, { type: QueryTypes.UPDATE });
    for (const job of due) await logSendEvent(Number(job.id), 'scheduled_released', null);
  }
  // A crashed run leaves items in 'sending': hand them back after 15 minutes.
  await sequelize.query(`UPDATE crm_template_send_items SET status = 'queued', lock_token = NULL WHERE status = 'sending' AND locked_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE)`, { type: QueryTypes.UPDATE });

  const result = { sent: 0, failed: 0, skipped: 0, requeued: 0 };
  while (Date.now() - started < timeBudgetMs) {
    const [next] = await sequelize.query<{ id: number }>(
      `SELECT i.id FROM crm_template_send_items i JOIN crm_template_sends s ON s.id = i.send_id
       WHERE i.status = 'queued' AND i.next_attempt_at <= NOW() AND s.status IN ('queued', 'sending')
       ORDER BY i.next_attempt_at, i.id LIMIT 1`,
      { type: QueryTypes.SELECT },
    );
    if (!next) break;
    const outcome = await processItem(Number(next.id));
    if (outcome !== 'raced') result[outcome]++;
    if (outcome === 'sent' && SPACING_MS()) await sleep(SPACING_MS());
  }

  await sequelize.query(
    `UPDATE crm_template_sends s SET status = 'completed', completed_at = NOW()
     WHERE s.status = 'sending' AND NOT EXISTS (SELECT 1 FROM crm_template_send_items i WHERE i.send_id = s.id AND i.status IN ('queued', 'sending'))`,
    { type: QueryTypes.UPDATE },
  );
  return result;
}
