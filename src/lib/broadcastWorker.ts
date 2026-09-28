import { Op } from 'sequelize';
import { sequelize } from './sequelize';
import {
  CrmBroadcastRecipients,
  CrmBroadcastCampaigns,
  CrmBroadcastEvents,
  CrmMessageTemplateVersions,
  CrmMessageTemplates,
  CrmMessageSuppressions,
  CrmContactChannelConsents,
} from '@/models';
import { sendEmail } from './mailer';
import { sendSmsMessage } from './sms';
import { renderTemplateText, renderTemplateHtml, MissingTemplateVariablesError } from './broadcastTemplateRender';
import { isRecipientEligible } from './broadcastPreflight';
import { suppressionAddressHash } from './broadcastDedupeKeys';
import { checkDailyQuota } from './broadcastRateLimit';
import { fireCampaignEventTrigger } from './workflowTriggers';
import type { EmailTemplateComponents, SmsTemplateComponents, WhatsappTemplateComponents } from './broadcastTemplateSchemas';

// How long a rate-limited recipient waits before this worker looks at it
// again - long enough that a genuinely full daily quota won't be retried
// dozens of times before it actually has headroom again.
const RATE_LIMIT_RETRY_DELAY_MS = 60 * 60 * 1000;

// Broadcast send path. Primary trigger is BullMQ (src/lib/queues/broadcastQueue.ts,
// consumed by workers/index.ts) - a recipient is enqueued the moment it's
// ready to send (launch time, or scheduled_at_utc), so sending happens in
// near-real-time rather than waiting for a poll tick. The cron sweep
// (processDueBroadcastRecipients, src/lib/broadcast-worker-cron.ts) is kept
// as a reconciliation safety net at reduced frequency, catching any
// recipient whose enqueue call itself failed (a transient Redis blip
// between the DB insert and the enqueueBroadcastRecipient() call) - the DB
// row is always the source of truth, BullMQ is just "please look at this
// now," and processBroadcastRecipient() below is safe to call more than
// once for the same recipient (status guard + idempotency_key), which
// matters because both BullMQ redelivery and this reconciliation sweep can
// legitimately target the same row.
//
// IMPORTANT: this does not yet send WhatsApp messages through a real
// approved-template call (sendWhatsAppTemplateMessage in whatsapp.ts) - see
// dispatchToProvider() below for exactly where that wiring stops short, and
// why (no live WABA credentials in this environment to build/test the
// Meta-component-parameter mapping against). A WhatsApp campaign cannot
// currently reach this worker at all, because the launch route's preflight
// (checkTemplateApprovedForLaunch) already blocks it - see
// src/app/api/broadcast/campaigns/[id]/launch/route.ts.

const CLAIM_STALE_AFTER_MS = 5 * 60 * 1000; // recover a crashed worker's claim after 5 minutes
const WORKER_ID = `broadcast-worker-${process.pid}`;

async function claimRecipientById(recipientId: number): Promise<CrmBroadcastRecipients | null> {
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  const [claimedCount] = await CrmBroadcastRecipients.update(
    { claimedAt: new Date(), claimedBy: WORKER_ID },
    {
      where: {
        id: recipientId,
        status: 'queued',
        [Op.or]: [{ claimedAt: null }, { claimedAt: { [Op.lt]: staleThreshold } }],
      },
    }
  );
  if (claimedCount === 0) return null; // already claimed by another worker, already sent, or not due
  return CrmBroadcastRecipients.findOne({ where: { id: recipientId, claimedBy: WORKER_ID } });
}

async function claimDueRecipients(limit: number): Promise<CrmBroadcastRecipients[]> {
  // Two-step claim (SELECT candidate ids, then UPDATE ... WHERE id IN (...) AND still-claimable)
  // rather than a single UPDATE ... LIMIT, since MySQL doesn't support
  // UPDATE ... ORDER BY ... LIMIT combined with a subquery on the same
  // table portably across MySQL/MariaDB - matches the read-then-claim shape
  // src/lib/jobQueue.ts already uses for the same reason.
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);

  const candidates = await CrmBroadcastRecipients.findAll({
    where: {
      status: 'queued',
      [Op.or]: [{ claimedAt: null }, { claimedAt: { [Op.lt]: staleThreshold } }],
    },
    order: [['id', 'ASC']],
    limit,
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((row) => row.id);
  const [claimedCount] = await CrmBroadcastRecipients.update(
    { claimedAt: new Date(), claimedBy: WORKER_ID },
    {
      where: {
        id: { [Op.in]: ids },
        status: 'queued',
        [Op.or]: [{ claimedAt: null }, { claimedAt: { [Op.lt]: staleThreshold } }],
      },
    }
  );
  if (claimedCount === 0) return [];

  return CrmBroadcastRecipients.findAll({ where: { id: { [Op.in]: ids }, claimedBy: WORKER_ID } });
}

async function dispatchToProvider(
  channel: 'email' | 'whatsapp' | 'sms',
  address: string,
  version: { components: unknown; exportHtml: string | null },
  values: Record<string, string>,
  context: { actorId: null; leadId: number | null }
): Promise<{ providerMessageId: string | null }> {
  if (channel === 'email') {
    const email = version.components as EmailTemplateComponents;
    const subject = renderTemplateText(email.subject, values);
    const html = version.exportHtml ? renderTemplateHtml(version.exportHtml, values) : subject;
    const result = await sendEmail({ to: address, subject, html, text: subject });
    return { providerMessageId: (result as { id?: string })?.id ?? null };
  }

  if (channel === 'sms') {
    const sms = version.components as SmsTemplateComponents;
    const text = renderTemplateText(sms.text, values);
    const result = await sendSmsMessage({ to: address, message: text, ...context });
    return { providerMessageId: (result as { id?: string } | undefined)?.id ?? null };
  }

  // WhatsApp: deliberately NOT wired to sendWhatsAppTemplateMessage() yet.
  // Reaching this branch would mean a WhatsApp campaign got past the launch
  // preflight without a real Meta-approved template, which
  // checkTemplateApprovedForLaunch() is specifically designed to prevent -
  // so this is a defensive error, not a silent fallback to plain-text
  // sendWhatsAppMessage() (which would violate the 24h-window/template rule
  // this whole feature exists to enforce).
  const whatsapp = version.components as WhatsappTemplateComponents;
  void whatsapp;
  throw new Error('WhatsApp campaign sending is not implemented - checkTemplateApprovedForLaunch should have blocked this campaign from launching');
}

export type BroadcastRecipientOutcome = 'sent' | 'failed' | 'skipped' | 'not_due';

// The actual per-recipient send logic - called by the BullMQ worker
// (workers/index.ts) for one job, and by the reconciliation sweep below for
// each due row it finds. Safe to call more than once for the same
// recipientId: claimRecipientById() only succeeds once per lease window, so
// a redelivered/duplicate call simply returns 'not_due' and does nothing.
export async function processBroadcastRecipient(recipientId: number): Promise<BroadcastRecipientOutcome> {
  const recipient = await claimRecipientById(recipientId);
  if (!recipient) return 'not_due';

  // Re-check cancellation/pause immediately before sending, per the spec's
  // "Allow cancellation and pause checks immediately before each external
  // send" rule. Cancellation is terminal (skip permanently); pause is not -
  // POST .../pause deliberately leaves recipient rows as 'queued' so
  // resuming picks them back up, so a paused campaign's claimed-but-not-
  // yet-sent recipient must only have its claim released, never be marked
  // skipped, or resuming would silently drop it forever.
  const campaign = await CrmBroadcastCampaigns.findByPk(recipient.campaignId);
  if (!campaign) {
    await recipient.update({ status: 'skipped_cancelled', claimedAt: null, claimedBy: null });
    return 'skipped';
  }
  if (campaign.status === 'paused' || campaign.status === 'scheduled') {
    await recipient.update({ claimedAt: null, claimedBy: null });
    return 'not_due';
  }
  if (campaign.status !== 'running') {
    await recipient.update({ status: 'skipped_cancelled', claimedAt: null, claimedBy: null });
    await maybeCompleteCampaign(recipient.campaignId);
    return 'skipped';
  }

  // Per-channel daily quota (src/lib/broadcastRateLimit.ts) - release the
  // claim and re-enqueue for later rather than fail/skip, since being over
  // quota is a temporary, self-resolving condition, not a reason to give up
  // on this recipient.
  const quota = await checkDailyQuota(recipient.channel);
  if (!quota.withinQuota) {
    await recipient.update({ claimedAt: null, claimedBy: null });
    const { enqueueBroadcastRecipient } = await import('./queues/broadcastQueue');
    await enqueueBroadcastRecipient(recipient.id, RATE_LIMIT_RETRY_DELAY_MS);
    return 'not_due';
  }

  // Re-check suppression/consent immediately before sending too - both
  // could have changed (a reply, an unsubscribe click, a manual
  // suppression) in the time between launch-time snapshot and this send.
  const addressHash = suppressionAddressHash(recipient.addressSnapshot);
  const [isSuppressed, consent] = await Promise.all([
    CrmMessageSuppressions.findOne({ where: { channel: recipient.channel, addressHash } }),
    recipient.leadId
      ? CrmContactChannelConsents.findOne({ where: { leadId: recipient.leadId, channel: recipient.channel, purpose: 'marketing' } })
      : Promise.resolve(null),
  ]);
  const eligibility = isRecipientEligible({
    purpose: 'marketing',
    consentState: consent?.consentState ?? 'unknown',
    isSuppressed: Boolean(isSuppressed),
  });
  if (!eligibility.eligible) {
    const status = eligibility.reason === 'suppressed' ? 'skipped_suppressed' : 'skipped_consent';
    await recipient.update({ status, claimedAt: null, claimedBy: null });
    await maybeCompleteCampaign(recipient.campaignId);
    return 'skipped';
  }

  const version = await CrmMessageTemplateVersions.findByPk(recipient.templateVersionId);
  const template = version ? await CrmMessageTemplates.findByPk(version.templateId) : null;

  try {
    if (!version || !template) throw new Error('Template version no longer exists');
    const { providerMessageId } = await dispatchToProvider(
      recipient.channel,
      recipient.addressSnapshot,
      { components: version.components, exportHtml: version.exportHtml },
      (recipient.renderedVariables as Record<string, string> | null) ?? {},
      { actorId: null, leadId: recipient.leadId }
    );

    await recipient.update({
      status: 'sent',
      sentAt: new Date(),
      providerMessageId,
      attempts: recipient.attempts + 1,
      claimedAt: null,
      claimedBy: null,
    });
    await CrmBroadcastEvents.create({
      recipientId: recipient.id, campaignId: recipient.campaignId, eventType: 'sent', providerEventId: null, rawPayload: null,
    });
    void fireCampaignEventTrigger({ leadId: recipient.leadId, campaignId: recipient.campaignId, eventType: 'sent' });
    await CrmBroadcastCampaigns.increment('sentCount', { by: 1, where: { id: recipient.campaignId } });
    await maybeCompleteCampaign(recipient.campaignId);
    return 'sent';
  } catch (error) {
    const message = error instanceof MissingTemplateVariablesError ? error.message : (error instanceof Error ? error.message : String(error));
    await recipient.update({
      status: 'failed',
      failureReason: message,
      attempts: recipient.attempts + 1,
      claimedAt: null,
      claimedBy: null,
    });
    await CrmBroadcastEvents.create({
      recipientId: recipient.id, campaignId: recipient.campaignId, eventType: 'failed', providerEventId: null, rawPayload: { error: message },
    });
    await CrmBroadcastCampaigns.increment('failedCount', { by: 1, where: { id: recipient.campaignId } });
    await maybeCompleteCampaign(recipient.campaignId);
    return 'failed';
  }
}

// A campaign with zero remaining pending/queued recipients has nothing left
// to do - mark it completed so the campaign list/dashboard stops showing
// it as "running".
async function maybeCompleteCampaign(campaignId: number): Promise<void> {
  const remaining = await CrmBroadcastRecipients.count({ where: { campaignId, status: { [Op.in]: ['pending', 'queued'] } } });
  if (remaining === 0) {
    await CrmBroadcastCampaigns.update(
      { status: 'completed', completedAt: new Date() },
      { where: { id: campaignId, status: 'running' } }
    );
  }
}

export interface BroadcastWorkerTickResult {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

// Reconciliation sweep - not the primary delivery path (BullMQ is, see the
// file header comment). Runs at a reduced cadence from
// src/lib/broadcast-worker-cron.ts and just re-drives
// processBroadcastRecipient() for anything still 'queued' that BullMQ
// apparently never got a job enqueued for.
export async function processDueBroadcastRecipients(limit = 20): Promise<BroadcastWorkerTickResult> {
  const recipients = await claimDueRecipients(limit);
  // claimDueRecipients already claimed these rows, so give them straight to
  // processBroadcastRecipient()'s post-claim logic by releasing the claim
  // first - simplest way to reuse the single-item function without a second
  // "already claimed by me" code path. The window between release and
  // re-claim is negligible and only matters if a third process also happens
  // to be polling, which this deployment doesn't do.
  const result: BroadcastWorkerTickResult = { claimed: recipients.length, sent: 0, failed: 0, skipped: 0 };
  for (const recipient of recipients) {
    await recipient.update({ claimedAt: null, claimedBy: null });
    const outcome = await processBroadcastRecipient(recipient.id);
    if (outcome === 'sent') result.sent += 1;
    else if (outcome === 'failed') result.failed += 1;
    else if (outcome === 'skipped') result.skipped += 1;
  }
  return result;
}

// Flips a 'scheduled' campaign (and its 'pending' recipients) to
// 'running'/'queued' once scheduled_at_utc has passed, and enqueues each
// newly-queued recipient into BullMQ immediately. Separate from
// processDueBroadcastRecipients() so the cron tick can run this cheap check
// without re-scanning every campaign's recipients each time.
export async function activateDueScheduledCampaigns(): Promise<number> {
  const dueCampaigns = await CrmBroadcastCampaigns.findAll({
    where: { status: 'scheduled', scheduledAtUtc: { [Op.lte]: new Date() } },
  });

  for (const campaign of dueCampaigns) {
    const activatedRecipients = await sequelize.transaction(async (transaction) => {
      const pending = await CrmBroadcastRecipients.findAll({
        where: { campaignId: campaign.id, status: 'pending' },
        attributes: ['id'],
        transaction,
      });
      await CrmBroadcastRecipients.update(
        { status: 'queued' },
        { where: { campaignId: campaign.id, status: 'pending' }, transaction }
      );
      await campaign.update({ status: 'running', launchedAt: new Date() }, { transaction });
      return pending.map((row) => row.id);
    });

    const { enqueueBroadcastRecipient } = await import('./queues/broadcastQueue');
    await Promise.all(activatedRecipients.map((id) => enqueueBroadcastRecipient(id)));
  }

  return dueCampaigns.length;
}
