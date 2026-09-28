import { NextRequest, NextResponse } from 'next/server';
import { Op } from 'sequelize';
import { connectDB } from '@/lib/sequelize';
import { validateWebhookSignature } from '@/lib/meta/webhook';
import { extractInboundMessages, extractStatusChanges, isOptOutMessage, type WhatsAppInboundMessage, type WhatsAppStatusChange } from '@/lib/whatsappWebhook';
import { CrmBroadcastRecipients, CrmBroadcastEvents, CrmBroadcastCampaigns, CrmContactChannelConsents, CrmContactConsentEvents, CrmBotSessions, CrmBotMessages } from '@/models';
import { findLeadIdByPhone } from '@/lib/phoneLookup';
import { waitEventCorrelationKey, botMessageDedupKey } from '@/lib/broadcastDedupeKeys';
import { resumeWaitForEvent } from '@/lib/workflowRuntime';
import { fireInboundMessageBotTrigger, fireCampaignEventTrigger } from '@/lib/workflowTriggers';

// Inbound WhatsApp Cloud API webhook - the counterpart to
// src/app/api/webhooks/meta/route.ts (Lead Ads), same Meta app but a
// different product/payload shape entirely (see src/lib/whatsappWebhook.ts's
// header comment). Same verify-then-persist-then-200 pattern: signature
// checked before any parsing, response returned promptly.
//
// SCOPE - what this does and does not do:
//  1. Delivery/read/failed status updates for messages this CRM sent
//     (matched by provider_message_id on crm_broadcast_recipients) flow
//     into crm_broadcast_events via a monotonic status state machine (a
//     late/out-of-order "delivered" can never downgrade an already-'read'
//     recipient, and a 'failed' is only applied if nothing more advanced
//     already landed) - per the spec's "process webhook events out of
//     order" rule.
//  2. An inbound STOP/UNSUBSCRIBE-style message records a real opt-out
//     (crm_contact_channel_consents + the append-only crm_contact_consent_events).
//  3. An inbound message from a phone number with an ACTIVE crm_bot_sessions
//     row is logged to crm_bot_messages and resumes that session's workflow
//     wait, if any (resumeWaitForEvent).
//  4. Otherwise, if the phone number matches a lead who was recently sent a
//     broadcast message, that recipient is marked 'replied'.
//  5. Otherwise (no active session, no broadcast to reply to), a matched
//     lead falls through to fireInboundMessageBotTrigger() -
//     src/lib/workflowTriggers.ts's session-creation policy: the first
//     published 'bot' workflow with a trigger.inbound_message node for this
//     channel starts exactly one new session + enrollment.

let dbReady = false;
async function ensureDB() {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const configuredToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!configuredToken) {
    console.error('[WhatsApp Webhook] WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set');
    return new NextResponse('Server misconfiguration', { status: 500 });
  }
  if (mode === 'subscribe' && token === configuredToken) {
    return new NextResponse(challenge ?? '', { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-hub-signature-256');
  if (!validateWebhookSignature(rawBody, signature)) {
    console.warn('[WhatsApp Webhook] Invalid signature rejected');
    return new NextResponse('Invalid signature', { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  await ensureDB();

  const statusChanges = extractStatusChanges(payload);
  const inboundMessages = extractInboundMessages(payload);

  for (const change of statusChanges) {
    await processStatusChange(change).catch((error) => console.error('[WhatsApp Webhook] status change processing failed:', error));
  }
  for (const message of inboundMessages) {
    await processInboundMessage(message).catch((error) => console.error('[WhatsApp Webhook] inbound message processing failed:', error));
  }

  return new NextResponse('OK', { status: 200 });
}

// Ordinal rank for the monotonic status state machine - a status update is
// only applied if it advances the recipient further than where it already
// is, so a redelivered/out-of-order webhook can never move a recipient
// backward.
const STATUS_RANK: Record<string, number> = { pending: 0, queued: 0, sent: 1, delivered: 2, read: 3, replied: 4, failed: 1 };

async function processStatusChange(change: WhatsAppStatusChange): Promise<void> {
  const recipient = await CrmBroadcastRecipients.findOne({ where: { providerMessageId: change.providerMessageId } });
  if (!recipient) return; // not a broadcast-originated message (e.g. a transactional send, or an unrelated number)

  // Dedup via the unique provider_event_id constraint - Meta redelivers
  // webhooks, and this specific (message, status) pair may already be recorded.
  const providerEventId = `${change.providerMessageId}:${change.status}`;
  try {
    await CrmBroadcastEvents.create({
      recipientId: recipient.id,
      campaignId: recipient.campaignId,
      eventType: change.status,
      providerEventId,
      rawPayload: { status: change.status, errorMessage: change.errorMessage },
    });
  } catch {
    return; // unique constraint hit = already processed this exact update
  }

  if (change.status === 'failed') {
    // Never downgrade an already-delivered/read/replied recipient to failed.
    if (STATUS_RANK[recipient.status] < STATUS_RANK.delivered) {
      await recipient.update({ status: 'failed', failureReason: change.errorMessage ?? 'Delivery failed' });
      await CrmBroadcastCampaigns.increment('failedCount', { by: 1, where: { id: recipient.campaignId } });
    }
    return;
  }

  if (STATUS_RANK[change.status] > (STATUS_RANK[recipient.status] ?? 0)) {
    const updates: Record<string, unknown> = { status: change.status };
    if (change.status === 'delivered') updates.deliveredAt = new Date();
    if (change.status === 'read') updates.readAt = new Date();
    await recipient.update(updates);
    if (change.status === 'delivered' || change.status === 'read') {
      void fireCampaignEventTrigger({ leadId: recipient.leadId, campaignId: recipient.campaignId, eventType: change.status });
    }
  }
}

async function processInboundMessage(message: WhatsAppInboundMessage): Promise<void> {
  const leadId = await findLeadIdByPhone(message.from);

  if (isOptOutMessage(message.text)) {
    await recordOptOut(leadId, message.from);
  }

  const activeSession = await CrmBotSessions.findOne({
    where: { channel: 'whatsapp', address: message.from, status: 'active' },
  });

  if (activeSession) {
    await CrmBotMessages.create({
      sessionId: activeSession.id,
      leadId: activeSession.leadId,
      direction: 'inbound',
      messageType: message.type,
      body: message.text,
      dedupKey: botMessageDedupKey(activeSession.id, message.providerMessageId),
    }).catch(() => { /* unique dedup key = already recorded this exact inbound message */ });

    await activeSession.update({ lastInboundAt: new Date() });

    if (activeSession.enrollmentId) {
      // Generic "the bot's counterpart is waiting on any reply" correlation -
      // matches bot.ask_question/bot.quick_reply nodes (src/lib/workflowRuntime.ts),
      // which both wait on this same fixed eventType. The message text is
      // passed through so bot.quick_reply can pick its branch and
      // bot.ask_question can capture the answer into session_state.
      await resumeWaitForEvent(waitEventCorrelationKey(activeSession.enrollmentId, 'inbound_message'), { text: message.text });
    }
    return;
  }

  if (!leadId) return;

  // No active bot session - if this looks like a reply to a recent
  // broadcast, mark that recipient 'replied' rather than silently dropping
  // the message. A specific broadcast reply takes priority over starting a
  // new bot conversation (checked below) - both could technically match
  // (a lead who was recently broadcast to messages in out of the blue), and
  // "they replied to our campaign" is the more specific, useful fact to
  // record.
  const recentRecipient = await CrmBroadcastRecipients.findOne({
    where: { leadId, channel: 'whatsapp', status: { [Op.in]: ['sent', 'delivered', 'read'] } },
    order: [['sentAt', 'DESC']],
  });
  if (recentRecipient) {
    await recentRecipient.update({ status: 'replied', repliedAt: new Date() });
    await CrmBroadcastEvents.create({
      recipientId: recentRecipient.id,
      campaignId: recentRecipient.campaignId,
      eventType: 'replied',
      providerEventId: `${message.providerMessageId}:replied`,
      rawPayload: { text: message.text },
    }).catch(() => { /* dedup */ });
    void fireCampaignEventTrigger({ leadId: recentRecipient.leadId, campaignId: recentRecipient.campaignId, eventType: 'replied' });
    return;
  }

  // Final fallback: no active session, no broadcast to reply to - see if a
  // published bot workflow wants to start a fresh conversation with this
  // lead (src/lib/workflowTriggers.ts's fireInboundMessageBotTrigger, the
  // session-creation policy this webhook previously left undecided).
  await fireInboundMessageBotTrigger({
    leadId,
    address: message.from,
    channel: 'whatsapp',
    branchId: null,
    providerMessageId: message.providerMessageId,
  });
}

async function recordOptOut(leadId: number | null, address: string): Promise<void> {
  if (!leadId) return;
  const now = new Date();

  await CrmContactChannelConsents.upsert({
    leadId,
    channel: 'whatsapp',
    purpose: 'marketing',
    address,
    consentState: 'opted_out',
    source: 'reply_stop',
    optedOutAt: now,
  });

  await CrmContactConsentEvents.create({
    leadId,
    channel: 'whatsapp',
    purpose: 'marketing',
    eventType: 'opt_out',
    source: 'reply_stop',
    actorId: null,
  });
}
