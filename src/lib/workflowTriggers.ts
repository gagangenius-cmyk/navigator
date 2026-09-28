import { CrmWorkflowDefinitions, CrmWorkflowVersions, CrmBotSessions } from '@/models';
import { enrollLead } from './workflowRuntime';
import { enrollmentPolicyKey } from './broadcastDedupeKeys';
import { isBroadcastAutomationEnabled } from './broadcastFeatureFlags';
import type { WorkflowGraph } from './workflowGraphValidator';

// Bridges real CRM events to the workflow runtime's enrollLead(). This is
// the one piece that makes trigger.* nodes (src/lib/workflowNodeRegistry.ts)
// actually fire, instead of only being validatable graph decorations.
//
// SCOPE - what this covers and what it doesn't:
// All 6 trigger.* node types now have a listener here:
// fireLeadCreatedTrigger() (called from src/lib/leadDefaults.ts's
// insertLeadRecord() and, directly, from src/lib/webToLeadsIngest.ts and
// the bulk-Excel-import branch of src/app/api/leads/route.ts - the two
// lead-creation paths that don't go through insertLeadRecord()),
// fireLeadUpdatedTrigger()/fireStageChangedTrigger() (src/app/api/leads/[id]/route.ts's
// PUT), fireFormSubmittedTrigger() (src/lib/webToLeadsIngest.ts,
// src/app/api/lead-intake/route.ts), fireInboundMessageBotTrigger()
// (src/app/api/webhooks/whatsapp/route.ts), and fireCampaignEventTrigger()
// (src/lib/broadcastWorker.ts, src/app/api/webhooks/whatsapp/route.ts).
// Auditing every remaining raw `INSERT INTO crm_forum_leads` call site
// beyond the two above (11 files matched at the time this was first
// written) for whether they're real lead-creation paths or legacy/test code
// is still real, separate follow-up work, not something to guess at here.
//
// Always fire-and-forget from the caller's perspective (never awaited at
// the call site, matching invalidateReportCaches()'s own pattern in that
// same function) and internally swallows its own errors - a workflow
// automation failure must never break lead creation.
export async function fireLeadCreatedTrigger(leadId: number, branchId: number | null): Promise<void> {
  if (!isBroadcastAutomationEnabled()) return;

  try {
    const definitions = await CrmWorkflowDefinitions.findAll({
      where: { workflowType: 'automation', status: 'published', isDeleted: false },
    });

    for (const definition of definitions) {
      if (!definition.currentPublishedVersionId) continue;
      const version = await CrmWorkflowVersions.findByPk(definition.currentPublishedVersionId);
      if (!version) continue;

      const graph = version.graphJson as WorkflowGraph;
      const triggerNode = graph.nodes.find((node) => node.type === 'trigger.lead_created');
      if (!triggerNode) continue;

      const config = triggerNode.data as { branchId?: number };
      if (config.branchId !== undefined && config.branchId !== branchId) continue;

      await enrollLead({
        workflowVersionId: version.id,
        leadId,
        enrollmentPolicyKey: enrollmentPolicyKey(definition.id, leadId, 'lead_created'),
      });
    }
  } catch (error) {
    console.error('Failed to fire lead.created workflow trigger:', error);
  }
}

// Session-creation policy for an inbound message with NO existing active
// crm_bot_sessions row - called from src/app/api/webhooks/whatsapp/route.ts
// only after that route has already checked for (and found none of) an
// active session or a matching broadcast-recipient reply. Policy decided
// explicitly rather than left unimplemented: the FIRST published
// 'bot'-type workflow with a trigger.inbound_message node matching this
// channel starts exactly one session - not one session per matching
// workflow (two bots replying to the same inbound message on the same
// channel makes no sense), and only when the sender matched an existing
// lead (enrollLead() requires a leadId; starting a session for a totally
// unknown number is a different, unaddressed question - see this file's
// header comment history in docs/broadcast-architecture.md).
export async function fireInboundMessageBotTrigger(input: {
  leadId: number;
  address: string;
  channel: 'whatsapp' | 'sms';
  branchId: number | null;
  /** The inbound message's provider id - stable across Meta's webhook redelivery, unlike a timestamp, so enrollmentPolicyKey actually dedups. */
  providerMessageId: string;
}): Promise<CrmBotSessions | null> {
  if (!isBroadcastAutomationEnabled()) return null;

  try {
    const definitions = await CrmWorkflowDefinitions.findAll({
      where: { workflowType: 'bot', status: 'published', isDeleted: false },
    });

    for (const definition of definitions) {
      if (!definition.currentPublishedVersionId) continue;
      const version = await CrmWorkflowVersions.findByPk(definition.currentPublishedVersionId);
      if (!version) continue;

      const graph = version.graphJson as WorkflowGraph;
      const triggerNode = graph.nodes.find((node) => node.type === 'trigger.inbound_message');
      if (!triggerNode) continue;

      const config = triggerNode.data as { channel?: 'whatsapp' | 'sms' };
      if (config.channel !== input.channel) continue;

      const enrollment = await enrollLead({
        workflowVersionId: version.id,
        leadId: input.leadId,
        enrollmentPolicyKey: enrollmentPolicyKey(definition.id, input.leadId, `inbound_message:${input.providerMessageId}`),
      });

      // enrollLead() is itself idempotent (returns the existing enrollment
      // on a redelivered webhook) - but this function must be too, or a
      // redelivery would still create a second crm_bot_sessions row
      // pointing at that same (correctly deduped) enrollment.
      const existingSession = await CrmBotSessions.findOne({ where: { enrollmentId: enrollment.id } });
      if (existingSession) return existingSession;

      return CrmBotSessions.create({
        branchId: input.branchId,
        channel: input.channel,
        leadId: input.leadId,
        address: input.address,
        workflowVersionId: version.id,
        enrollmentId: enrollment.id,
        status: 'active',
        lastInboundAt: new Date(),
      });
    }
  } catch (error) {
    console.error('Failed to fire inbound.message bot trigger:', error);
  }
  return null;
}

// General "one or more lead fields changed" trigger - src/app/api/leads/[id]/route.ts's
// PUT handler calls this after every successful update, passing only the
// fields that actually changed *value* (not just fields the request
// happened to include - re-saving an unchanged value must not fire this).
export async function fireLeadUpdatedTrigger(leadId: number, changedFields: string[]): Promise<void> {
  if (!isBroadcastAutomationEnabled() || changedFields.length === 0) return;

  try {
    const definitions = await CrmWorkflowDefinitions.findAll({
      where: { workflowType: 'automation', status: 'published', isDeleted: false },
    });

    for (const definition of definitions) {
      if (!definition.currentPublishedVersionId) continue;
      const version = await CrmWorkflowVersions.findByPk(definition.currentPublishedVersionId);
      if (!version) continue;

      const graph = version.graphJson as WorkflowGraph;
      const triggerNode = graph.nodes.find((node) => node.type === 'trigger.lead_updated');
      if (!triggerNode) continue;

      // An empty/absent watchedFields means "any field" - otherwise only
      // fire when at least one field this workflow cares about changed.
      const config = triggerNode.data as { watchedFields?: string[] };
      if (config.watchedFields?.length && !config.watchedFields.some((field) => changedFields.includes(field))) continue;

      await enrollLead({
        workflowVersionId: version.id,
        leadId,
        // Each PUT is its own real-world event, and unlike a webhook
        // (see fireInboundMessageBotTrigger above) nothing redelivers this
        // request automatically, so Date.now() is a safe idempotency
        // component here - it doesn't need to defend against retries, only
        // to let genuinely distinct updates each enroll.
        enrollmentPolicyKey: enrollmentPolicyKey(definition.id, leadId, `lead_updated:${Date.now()}:${changedFields.slice().sort().join(',')}`),
      });
    }
  } catch (error) {
    console.error('Failed to fire lead.updated workflow trigger:', error);
  }
}

// A lead's status field transitioned from one value to another - the
// narrower, semantically-named sibling of fireLeadUpdatedTrigger() above,
// for workflows that specifically care about stage/status movement.
export async function fireStageChangedTrigger(leadId: number, fromStage: string | null, toStage: string): Promise<void> {
  if (!isBroadcastAutomationEnabled()) return;

  try {
    const definitions = await CrmWorkflowDefinitions.findAll({
      where: { workflowType: 'automation', status: 'published', isDeleted: false },
    });

    for (const definition of definitions) {
      if (!definition.currentPublishedVersionId) continue;
      const version = await CrmWorkflowVersions.findByPk(definition.currentPublishedVersionId);
      if (!version) continue;

      const graph = version.graphJson as WorkflowGraph;
      const triggerNode = graph.nodes.find((node) => node.type === 'trigger.stage_changed');
      if (!triggerNode) continue;

      const config = triggerNode.data as { fromStage?: string; toStage?: string };
      if (config.fromStage && config.fromStage !== fromStage) continue;
      if (config.toStage && config.toStage !== toStage) continue;

      await enrollLead({
        workflowVersionId: version.id,
        leadId,
        enrollmentPolicyKey: enrollmentPolicyKey(definition.id, leadId, `stage_changed:${Date.now()}:${fromStage}:${toStage}`),
      });
    }
  } catch (error) {
    console.error('Failed to fire stage.changed workflow trigger:', error);
  }
}

// A public lead-capture form was submitted - called from the intake paths
// that create a lead from an external form post (src/lib/webToLeadsIngest.ts
// and src/app/api/lead-intake/route.ts). `formKey` distinguishes which
// intake path this was, matching the node's own configSchema; an admin
// building a workflow picks the exact form they want to react to.
export async function fireFormSubmittedTrigger(leadId: number, formKey: string): Promise<void> {
  if (!isBroadcastAutomationEnabled()) return;

  try {
    const definitions = await CrmWorkflowDefinitions.findAll({
      where: { workflowType: 'automation', status: 'published', isDeleted: false },
    });

    for (const definition of definitions) {
      if (!definition.currentPublishedVersionId) continue;
      const version = await CrmWorkflowVersions.findByPk(definition.currentPublishedVersionId);
      if (!version) continue;

      const graph = version.graphJson as WorkflowGraph;
      const triggerNode = graph.nodes.find((node) => node.type === 'trigger.form_submitted');
      if (!triggerNode) continue;

      const config = triggerNode.data as { formKey: string };
      if (config.formKey !== formKey) continue;

      await enrollLead({
        workflowVersionId: version.id,
        leadId,
        enrollmentPolicyKey: enrollmentPolicyKey(definition.id, leadId, `form_submitted:${formKey}`),
      });
    }
  } catch (error) {
    console.error('Failed to fire form.submitted workflow trigger:', error);
  }
}

// A broadcast campaign's recipient reached a new delivery-status event -
// called right after each site that records a CrmBroadcastEvents row for an
// identifiable lead (src/lib/broadcastWorker.ts's send path,
// src/app/api/webhooks/whatsapp/route.ts's status-change and
// reply-detection paths). 'bounced' and 'opted_out' are in the node's
// configSchema (matching the originating spec) but this codebase has no
// concrete event source for either yet: WhatsApp reports a delivery failure
// as 'failed' (not recorded as a distinct bounce), and an opt-out is
// recorded as a consent-state change (processInboundMessage's
// recordOptOut(), same file) rather than a per-campaign event - so there is
// nothing to fire this trigger from for those two event types yet.
export async function fireCampaignEventTrigger(input: {
  leadId: number | null;
  campaignId: number;
  eventType: 'sent' | 'delivered' | 'read' | 'replied' | 'bounced' | 'opted_out';
}): Promise<void> {
  if (!isBroadcastAutomationEnabled() || !input.leadId) return;

  try {
    const definitions = await CrmWorkflowDefinitions.findAll({
      where: { workflowType: 'automation', status: 'published', isDeleted: false },
    });

    for (const definition of definitions) {
      if (!definition.currentPublishedVersionId) continue;
      const version = await CrmWorkflowVersions.findByPk(definition.currentPublishedVersionId);
      if (!version) continue;

      const graph = version.graphJson as WorkflowGraph;
      const triggerNode = graph.nodes.find((node) => node.type === 'trigger.campaign_event');
      if (!triggerNode) continue;

      const config = triggerNode.data as { campaignId?: number; eventType: string };
      if (config.eventType !== input.eventType) continue;
      if (config.campaignId !== undefined && config.campaignId !== input.campaignId) continue;

      await enrollLead({
        workflowVersionId: version.id,
        leadId: input.leadId,
        enrollmentPolicyKey: enrollmentPolicyKey(definition.id, input.leadId, `campaign_event:${input.campaignId}:${input.eventType}`),
      });
    }
  } catch (error) {
    console.error('Failed to fire campaign.event workflow trigger:', error);
  }
}
