import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import type { User } from '@/lib/auth';
import { CrmMessageTemplateVersions } from '@/models';
import { canUseTemplate } from '@/lib/messageTemplateScope';
import { purposeForCategory } from '@/lib/broadcastPurpose';
import { logAudit } from '@/lib/auditLog';
import { ensureTemplateSendTables } from './schema';
import { logSendEvent } from './events';
import { MAX_EMAILS_PER_HOUR, MAX_LEADS_PER_SEND, resolveRecipients, summarize, type SenderMode } from './recipients';

export class TemplateSendError extends Error {
  constructor(message: string, public readonly status = 422) { super(message); }
}

const toMysql = (date: Date) => date.toISOString().slice(0, 19).replace('T', ' ');

/**
 * The template a user may send from this screen: one they are allowed to use, an email template, and a
 * service-type category (appointment / follow-up / payment reminder / service update). Promotional
 * mail needs explicit opt-in per recipient and goes through Broadcast campaigns instead.
 */
export async function getSendableTemplate(user: User, templateId: number) {
  const template = await canUseTemplate({ id: user.id, branch: user.branch, role: (user as { role?: number | null }).role ?? null }, templateId);
  if (!template || !template.currentPublishedVersionId) throw new TemplateSendError('Template not found', 404);
  if (template.channel !== 'email') throw new TemplateSendError('Only email templates can be sent from here');
  if (purposeForCategory(template.category) !== 'transactional') {
    throw new TemplateSendError('Marketing templates need recipient opt-in. Send them from Broadcast campaigns instead.');
  }
  const version = await CrmMessageTemplateVersions.findOne({ where: { id: template.currentPublishedVersionId, templateId: template.id } });
  if (!version) throw new TemplateSendError('Template has no published version', 404);
  return { template, version };
}

export interface CreateTemplateSendInput {
  leadIds: number[];
  templateId: number;
  senderMode: SenderMode;
  /** ISO timestamp; empty = send now. */
  scheduledAt?: string | null;
  idempotencyKey: string;
}

export async function createTemplateSend(user: User, input: CreateTemplateSendInput) {
  await ensureTemplateSendTables();
  const key = String(input.idempotencyKey || '').trim().slice(0, 100);
  if (!key) throw new TemplateSendError('Missing idempotency key', 400);
  // A double-clicked Confirm (or a retried request) returns the job already created.
  const [existing] = await sequelize.query<{ id: number }>('SELECT id FROM crm_template_sends WHERE idempotency_key = :key LIMIT 1', { replacements: { key }, type: QueryTypes.SELECT });
  if (existing) return { id: Number(existing.id), duplicate: true };

  if (!Array.isArray(input.leadIds) || !input.leadIds.length) throw new TemplateSendError('Select at least one lead');
  if (input.leadIds.length > MAX_LEADS_PER_SEND) throw new TemplateSendError(`You can send to at most ${MAX_LEADS_PER_SEND} leads at a time`);

  const [{ recent }] = await sequelize.query<{ recent: number }>(
    `SELECT COALESCE(SUM(total_queued), 0) AS recent FROM crm_template_sends
     WHERE created_by = :userId AND status <> 'cancelled' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    { replacements: { userId: user.id }, type: QueryTypes.SELECT },
  );
  if (Number(recent) + input.leadIds.length > MAX_EMAILS_PER_HOUR) {
    throw new TemplateSendError(`Hourly limit reached: up to ${MAX_EMAILS_PER_HOUR} emails per hour (${Number(recent)} already queued in the last hour). Please try again later.`, 429);
  }

  const { template, version } = await getSendableTemplate(user, Number(input.templateId));

  let scheduledUtc: Date | null = null;
  if (input.scheduledAt) {
    scheduledUtc = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledUtc.getTime())) throw new TemplateSendError('Invalid scheduled time');
    if (scheduledUtc.getTime() < Date.now() - 60_000) throw new TemplateSendError('The scheduled time is in the past');
    if (scheduledUtc.getTime() > Date.now() + 90 * 86_400_000) throw new TemplateSendError('Schedule at most 90 days ahead');
  }

  const recipients = await resolveRecipients(user, input.leadIds, input.senderMode);
  const summary = summarize(recipients);
  if (!summary.willSend) throw new TemplateSendError('None of the selected leads can be emailed - see the skipped reasons');

  const id = await sequelize.transaction(async (transaction) => {
    const [jobId] = await sequelize.query(
      `INSERT INTO crm_template_sends (template_id, template_version_id, template_name, sender_mode, status, scheduled_at_utc,
         total_selected, total_queued, total_skipped, idempotency_key, created_by)
       VALUES (:templateId, :versionId, :name, :mode, :status, :scheduledAt, :selected, :queued, :skipped, :key, :userId)`,
      {
        replacements: {
          templateId: template.id, versionId: version.id, name: template.name, mode: input.senderMode === 'owner' ? 'owner' : 'me',
          status: scheduledUtc ? 'scheduled' : 'queued', scheduledAt: scheduledUtc ? toMysql(scheduledUtc) : null,
          selected: recipients.length, queued: summary.willSend, skipped: summary.skippedTotal, key, userId: user.id,
        },
        type: QueryTypes.INSERT, transaction,
      },
    ) as unknown as [number, number];

    const rows = recipients.map((r) => [jobId, r.leadId, r.senderEmployeeId, r.mailboxId, r.toEmail, r.skipReason ? 'skipped' : 'queued', r.skipReason]);
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      await sequelize.query(
        `INSERT INTO crm_template_send_items (send_id, lead_id, sender_employee_id, mailbox_id, to_email, status, skip_reason)
         VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
        { replacements: chunk.flat(), type: QueryTypes.INSERT, transaction },
      );
    }
    return Number(jobId);
  });

  await logSendEvent(id, 'created', {
    template: template.name, templateVersionId: version.id, senderMode: input.senderMode,
    selected: recipients.length, queued: summary.willSend, skipped: summary.skipped,
    scheduledAt: scheduledUtc?.toISOString() ?? null,
  }, { actorId: user.id });
  void logAudit({
    entityType: 'template_send', entityId: String(id), action: 'created',
    summary: `Template "${template.name}" queued for ${summary.willSend} lead(s), ${summary.skippedTotal} skipped`,
    actorId: user.id, actorRole: user.roleName,
  });
  return { id, duplicate: false };
}

/** A job the user may see: its creator, or a manager who can send as each counsellor. */
export async function loadTemplateSend(id: number, user: User, seeAll: boolean) {
  await ensureTemplateSendTables();
  if (!Number.isInteger(id) || id < 1) return null;
  const [job] = await sequelize.query<Record<string, unknown>>(
    `SELECT s.*, SUM(i.status = 'sent') AS sent, SUM(i.status = 'failed') AS failed,
            SUM(i.status IN ('queued','sending')) AS pending, SUM(i.status = 'skipped') AS skipped
     FROM crm_template_sends s LEFT JOIN crm_template_send_items i ON i.send_id = s.id
     WHERE s.id = :id GROUP BY s.id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!job) return null;
  if (!seeAll && Number(job.created_by) !== Number(user.id)) return null;
  return job;
}
