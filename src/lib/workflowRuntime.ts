import { Op } from 'sequelize';
import crypto from 'crypto';
import { sequelize } from './sequelize';
import {
  CrmWorkflowEnrollments,
  CrmWorkflowVersions,
  CrmWorkflowStepExecutions,
  CrmWorkflowWaits,
  CrmcForumLeads,
  CrmcForumLeadsRemarks,
  CrmcFollowUpReminders,
  CrmBotSessions,
  CrmMessageTemplates,
  CrmMessageTemplateVersions,
} from '@/models';
import type { WorkflowGraph, WorkflowGraphNode } from './workflowGraphValidator';
import { evaluateConditionGroup, type ConditionContext } from './workflowConditionEvaluator';
import { getNodeTypeDef, isWebhookHostAllowed } from './workflowNodeRegistry';
import { stepExecutionIdempotencyKey, waitEventCorrelationKey } from './broadcastDedupeKeys';
import { sendWhatsAppMessage } from './whatsapp';
import { sendSmsMessage } from './sms';
import { sendEmail } from './mailer';
import { renderTemplateText, renderTemplateHtml } from './broadcastTemplateRender';
import { recordLeadAssignment } from './leadRemarks';
import { resolveLeadAssignment } from './assignmentRuleEngine';
import type { EmailTemplateComponents, SmsTemplateComponents } from './broadcastTemplateSchemas';

// The workflow runtime engine (docs/broadcast-architecture.md Phase 4).
// Same architectural shape as src/lib/broadcastWorker.ts: BullMQ
// (src/lib/queues/workflowQueue.ts, consumed by workers/index.ts) is the
// primary trigger - a step is enqueued the instant it's created, and a wait
// is scheduled as a BullMQ *delayed* job for its exact deadline instead of
// being discovered by a poll. processDueWorkflowSteps()/resolveDueWaits()
// below remain as a reduced-frequency reconciliation sweep (same reasoning
// as broadcastWorker.ts's sweep) for anything whose enqueue call itself
// failed. The DB (crm_workflow_step_executions/crm_workflow_waits) is
// always the source of truth; a BullMQ job is just "please look at this
// now," and every per-item function here is safe to call more than once
// for the same id (claim/status guards), since BullMQ redelivery and the
// reconciliation sweep can legitimately target the same row.
//
// IMPORTANT - honest scope of what actually executes right now:
// `condition`, `branch`, `wait.duration`/`wait.until`/`wait.for_event`,
// `action.update_lead`, `action.create_note` (crm_forum_leads_remarks),
// `action.create_task` (crm_follow_up_reminders - NOT crm_task, which is
// opportunity-scoped, not lead-scoped), and the three bot-flow node types
// (`bot.send_message`, `bot.ask_question`, `bot.quick_reply` - all send via
// the same sendWhatsAppMessage()/sendSmsMessage() a live 2-way conversation
// is allowed to use plain text on, per src/lib/workflowNodeRegistry.ts's own
// note on why that's fine here but not for cold broadcast) all have real
// handlers, each verified against this codebase's actual model files before
// being wired up. `bot.ask_question`/`bot.quick_reply` reuse the exact same
// wait-for-event machinery as automation workflows, correlated on a fixed
// eventType ('inbound_message') that src/app/api/webhooks/whatsapp/route.ts
// resolves - no separate bot-specific runtime exists, it's the same engine.
// `bot.handoff` (terminal) flips the session's crm_bot_sessions row to
// 'handed_off'.
// `action.send_email_template`/`action.send_sms` load the template's
// currently PUBLISHED version only (never a draft) and render it against
// the enrollment's own lead fields. `action.assign_agent` handles both a
// direct `agentId` and `strategy: 'round_robin'` - the latter calls into
// this CRM's real round-robin engine (src/lib/assignmentRuleEngine.ts's
// resolveLeadAssignment(), the same one every other assignment path uses)
// rather than a second, workflow-only algorithm, and either path then
// stamps the assignment through recordLeadAssignment() so it looks
// identical to a manual assignment everywhere else in the app.
// `action.add_tag`/`action.remove_tag` write to `crm_forum_leads.tags` - a
// real column, but a single free-text VARCHAR(500), not a proper tags
// table (verified before wiring this up, not assumed); comma-separated is
// this handler's own convention since no existing code establishes one.
// `action.webhook` calls out only through `isWebhookHostAllowed()`'s
// fail-closed allowlist (`workflowNodeRegistry.ts`) - empty by default, so
// it refuses every host until a deployment explicitly opts partners in.
// Only `action.send_whatsapp_template` still throws NotImplementedNodeError
// - it requires a real Meta-approved WhatsApp template
// (checkTemplateApprovedForLaunch's exact rule), which nothing in this
// environment can produce without live WABA credentials.
//
// Bot session lifecycle: `src/lib/workflowTriggers.ts` now has both
// `fireLeadCreatedTrigger()` (automation workflows) and
// `fireInboundMessageBotTrigger()` (starts a NEW bot session + enrollment
// for a matched lead with no existing active session) - see that file.

export class NotImplementedNodeError extends Error {
  constructor(nodeType: string) {
    super(`No execution handler implemented yet for node type "${nodeType}"`);
    this.name = 'NotImplementedNodeError';
  }
}

const CLAIM_STALE_AFTER_MS = 5 * 60 * 1000;
const WORKER_ID = `workflow-runtime-${process.pid}`;

function getGraph(version: { graphJson: unknown }): WorkflowGraph {
  return version.graphJson as WorkflowGraph;
}

function findNode(graph: WorkflowGraph, nodeId: string): WorkflowGraphNode {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found in workflow graph`);
  return node;
}

function findOutgoingEdges(graph: WorkflowGraph, nodeId: string) {
  return graph.edges.filter((edge) => edge.source === nodeId);
}

// Idempotent enrollment: enrollmentPolicyKey (caller-supplied, typically
// sha256(workflowId:leadId:triggerEventId)) means re-delivering the same
// trigger event twice never creates a second enrollment - the second call
// just returns the existing row.
export async function enrollLead(input: {
  workflowVersionId: number;
  leadId: number;
  enrollmentPolicyKey: string;
}): Promise<CrmWorkflowEnrollments> {
  const existing = await CrmWorkflowEnrollments.findOne({ where: { enrollmentPolicyKey: input.enrollmentPolicyKey } });
  if (existing) return existing;

  const version = await CrmWorkflowVersions.findByPk(input.workflowVersionId);
  if (!version) throw new Error('Workflow version not found');
  const graph = getGraph(version);

  const triggerNode = graph.nodes.find((n) => getNodeTypeDef(n.type)?.category === 'trigger');
  if (!triggerNode) throw new Error('Workflow graph has no trigger node');
  const firstEdge = findOutgoingEdges(graph, triggerNode.id)[0];

  let firstStepId: number | null = null;
  const enrollment = await sequelize.transaction(async (transaction) => {
    const created = await CrmWorkflowEnrollments.create({
      workflowVersionId: input.workflowVersionId,
      leadId: input.leadId,
      correlationId: crypto.randomUUID(),
      enrollmentPolicyKey: input.enrollmentPolicyKey,
      status: 'active',
    }, { transaction });

    if (firstEdge) {
      const step = await CrmWorkflowStepExecutions.create({
        enrollmentId: created.id,
        nodeId: firstEdge.target,
        nodeType: findNode(graph, firstEdge.target).type,
        idempotencyKey: stepExecutionIdempotencyKey(created.id, firstEdge.target, 1),
        attempt: 1,
      }, { transaction });
      firstStepId = step.id;
    } else {
      // A trigger with no outgoing edge is itself a (degenerate but valid
      // per the graph validator) complete workflow - nothing to execute.
      await created.update({ status: 'completed', endedAt: new Date() }, { transaction });
    }

    return created;
  });

  if (firstStepId !== null) {
    const { enqueueWorkflowStep } = await import('./queues/workflowQueue');
    await enqueueWorkflowStep(firstStepId);
  }

  return enrollment;
}

export interface WorkflowRuntimeTickResult {
  claimed: number;
  advanced: number;
  waiting: number;
  failed: number;
}

async function claimStepById(stepExecutionId: number): Promise<CrmWorkflowStepExecutions | null> {
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  const [claimedCount] = await CrmWorkflowStepExecutions.update(
    { status: 'claimed', claimedAt: new Date(), claimedBy: WORKER_ID, startedAt: new Date() },
    {
      where: {
        id: stepExecutionId,
        status: 'pending',
        [Op.or]: [{ claimedAt: null }, { claimedAt: { [Op.lt]: staleThreshold } }],
      },
    }
  );
  if (claimedCount === 0) return null;
  return CrmWorkflowStepExecutions.findOne({ where: { id: stepExecutionId, claimedBy: WORKER_ID, status: 'claimed' } });
}

async function claimDueSteps(limit: number): Promise<CrmWorkflowStepExecutions[]> {
  const staleThreshold = new Date(Date.now() - CLAIM_STALE_AFTER_MS);
  const candidates = await CrmWorkflowStepExecutions.findAll({
    where: { status: 'pending', [Op.or]: [{ claimedAt: null }, { claimedAt: { [Op.lt]: staleThreshold } }] },
    order: [['id', 'ASC']],
    limit,
  });
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const [claimedCount] = await CrmWorkflowStepExecutions.update(
    { status: 'claimed', claimedAt: new Date(), claimedBy: WORKER_ID, startedAt: new Date() },
    { where: { id: { [Op.in]: ids }, status: 'pending' } }
  );
  if (claimedCount === 0) return [];

  return CrmWorkflowStepExecutions.findAll({ where: { id: { [Op.in]: ids }, claimedBy: WORKER_ID, status: 'claimed' } });
}

// Creates the step_execution row for each given edge's target node, then
// enqueues each one (BullMQ) only after all inserts have committed - never
// enqueue inside a still-open transaction, so a worker can never claim a
// row a rollback would then make disappear.
async function dispatchNextSteps(graph: WorkflowGraph, enrollmentId: number, edges: WorkflowGraph['edges']): Promise<void> {
  const newStepIds: number[] = [];
  await sequelize.transaction(async (transaction) => {
    for (const edge of edges) {
      const step = await CrmWorkflowStepExecutions.create({
        enrollmentId,
        nodeId: edge.target,
        nodeType: findNode(graph, edge.target).type,
        idempotencyKey: stepExecutionIdempotencyKey(enrollmentId, edge.target, 1),
        attempt: 1,
      }, { transaction });
      newStepIds.push(step.id);
    }
  });

  if (newStepIds.length > 0) {
    const { enqueueWorkflowStep } = await import('./queues/workflowQueue');
    await Promise.all(newStepIds.map((id) => enqueueWorkflowStep(id)));
  }
}

// Executes one claimed step, advances the enrollment to whichever next
// node(s) apply, and marks the step succeeded/failed/waiting.
async function executeStep(step: CrmWorkflowStepExecutions): Promise<'advanced' | 'waiting' | 'failed'> {
  const enrollment = await CrmWorkflowEnrollments.findByPk(step.enrollmentId);
  if (!enrollment || enrollment.status === 'cancelled') {
    await step.update({ status: 'cancelled', claimedAt: null, claimedBy: null, completedAt: new Date() });
    return 'failed';
  }

  const version = await CrmWorkflowVersions.findByPk(enrollment.workflowVersionId);
  if (!version) throw new Error('Workflow version no longer exists');
  const graph = getGraph(version);
  const node = findNode(graph, step.nodeId);
  const def = getNodeTypeDef(node.type);
  if (!def) throw new Error(`Unknown node type "${node.type}"`);

  try {
    if (def.category === 'wait') {
      await createWaitRow(step, node, enrollment);
      await step.update({ status: 'waiting', claimedAt: null, claimedBy: null });
      await enrollment.update({ status: 'waiting' });
      return 'waiting';
    }

    // Terminal nodes (end/goal/bot.handoff) never reach runNodeHandler -
    // it has no case for them (they have nothing to "do" except end the
    // enrollment), and calling it here would previously throw
    // NotImplementedNodeError the moment any workflow reached its own end
    // node. bot.handoff additionally flips its crm_bot_sessions row to
    // 'handed_off', if one exists for this enrollment.
    if (def.isTerminal) {
      if (node.type === 'bot.handoff') {
        const data = node.data as { reason?: string };
        const session = await CrmBotSessions.findOne({ where: { enrollmentId: enrollment.id } });
        if (session) {
          await session.update({ status: 'handed_off', handoffAt: new Date(), handoffReason: data.reason ?? null });
        }
      }
      await step.update({ status: 'succeeded', completedAt: new Date(), claimedAt: null, claimedBy: null, outputSnapshot: { nextHandle: null } });
      await enrollment.update({ status: 'completed', endedAt: new Date() });
      return 'advanced';
    }

    const nextHandle = await runNodeHandler(node, enrollment);

    const outgoing = findOutgoingEdges(graph, node.id);
    const matchingEdges = nextHandle === undefined ? outgoing : outgoing.filter((e) => (e.sourceHandle ?? '') === nextHandle);

    await step.update({ status: 'succeeded', completedAt: new Date(), claimedAt: null, claimedBy: null, outputSnapshot: { nextHandle: nextHandle ?? null } });
    await dispatchNextSteps(graph, enrollment.id, matchingEdges);

    return 'advanced';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await step.update({ status: 'failed', errorMessage: message, completedAt: new Date(), claimedAt: null, claimedBy: null });
    return 'failed';
  }
}

// Called by the BullMQ worker (workers/index.ts) for one 'step' job. Safe
// to call more than once for the same id: claimStepById() only succeeds
// once per lease window, so a redelivered job simply no-ops.
export async function processWorkflowStepById(stepExecutionId: number): Promise<'advanced' | 'waiting' | 'failed' | 'not_due'> {
  const step = await claimStepById(stepExecutionId);
  if (!step) return 'not_due';
  return executeStep(step);
}

async function sendBotMessage(session: CrmBotSessions, text: string): Promise<void> {
  if (session.channel === 'whatsapp') {
    await sendWhatsAppMessage({ to: session.address, message: text, leadId: session.leadId });
  } else {
    await sendSmsMessage({ to: session.address, message: text, leadId: session.leadId });
  }
}

async function createWaitRow(step: CrmWorkflowStepExecutions, node: WorkflowGraphNode, enrollment: CrmWorkflowEnrollments) {
  let waitId: number;
  let deadlineAt: Date;

  if (node.type === 'bot.ask_question' || node.type === 'bot.quick_reply') {
    const session = await CrmBotSessions.findOne({ where: { enrollmentId: enrollment.id } });
    if (!session) throw new Error(`${node.type} requires an active crm_bot_sessions row for this enrollment`);

    if (node.type === 'bot.ask_question') {
      const data = node.data as { question: string; timeoutMinutes: number };
      await sendBotMessage(session, data.question);
      deadlineAt = new Date(Date.now() + data.timeoutMinutes * 60_000);
    } else {
      const data = node.data as { text: string; options: { value: string; label: string }[]; timeoutMinutes: number };
      await sendBotMessage(session, `${data.text}\n\n${data.options.map((o, i) => `${i + 1}. ${o.label}`).join('\n')}`);
      deadlineAt = new Date(Date.now() + data.timeoutMinutes * 60_000);
    }

    // Same correlation-key convention (fixed eventType 'inbound_message')
    // that src/app/api/webhooks/whatsapp/route.ts already resolves for any
    // active session's enrollment - no webhook change needed for these two
    // node types to work.
    const wait = await CrmWorkflowWaits.create({
      enrollmentId: step.enrollmentId, stepExecutionId: step.id, waitType: 'event',
      eventCorrelationKey: waitEventCorrelationKey(step.enrollmentId, 'inbound_message'),
      deadlineAt, timeoutAction: 'continue_via_timeout_branch',
    });
    waitId = wait.id;
    const { enqueueWaitDeadline } = await import('./queues/workflowQueue');
    await enqueueWaitDeadline(waitId, deadlineAt.getTime() - Date.now());
    return;
  }

  if (node.type === 'wait.duration') {
    const data = node.data as { amount: number; unit: 'minutes' | 'hours' | 'days' };
    const multiplier = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[data.unit];
    deadlineAt = new Date(Date.now() + data.amount * multiplier);
    const wait = await CrmWorkflowWaits.create({
      enrollmentId: step.enrollmentId, stepExecutionId: step.id, waitType: 'duration',
      deadlineAt, timeoutAction: 'continue_via_timeout_branch',
    });
    waitId = wait.id;
  } else if (node.type === 'wait.until') {
    const data = node.data as { isoDatetime?: string };
    deadlineAt = data.isoDatetime ? new Date(data.isoDatetime) : new Date();
    const wait = await CrmWorkflowWaits.create({
      enrollmentId: step.enrollmentId, stepExecutionId: step.id, waitType: 'until',
      deadlineAt, timeoutAction: 'continue_via_timeout_branch',
    });
    waitId = wait.id;
  } else {
    // wait.for_event
    const data = node.data as { eventType: string; timeoutMinutes: number };
    deadlineAt = new Date(Date.now() + data.timeoutMinutes * 60_000);
    const wait = await CrmWorkflowWaits.create({
      enrollmentId: step.enrollmentId, stepExecutionId: step.id, waitType: 'event',
      eventCorrelationKey: waitEventCorrelationKey(step.enrollmentId, data.eventType),
      deadlineAt, timeoutAction: 'continue_via_timeout_branch',
    });
    waitId = wait.id;
  }

  // Scheduled as a BullMQ delayed job firing at the exact deadline - this
  // is what actually replaces the old resolveDueWaits() poll with
  // deadline-accurate resolution instead of "found within the next minute."
  // For wait.for_event this only fires the *timeout* path (see
  // resolveWaitById); a matching inbound event resolves it earlier via
  // resumeWaitForEvent(), independent of this scheduled job.
  const { enqueueWaitDeadline } = await import('./queues/workflowQueue');
  await enqueueWaitDeadline(waitId, deadlineAt.getTime() - Date.now());
}

async function runNodeHandler(node: WorkflowGraphNode, enrollment: CrmWorkflowEnrollments): Promise<string | undefined> {
  if (node.type === 'condition') {
    const data = node.data as { root: ConditionGroupLike };
    const lead = enrollment.leadId ? await CrmcForumLeads.findByPk(enrollment.leadId) : null;
    const context = leadToConditionContext(lead);
    return evaluateConditionGroup(data.root, context) ? 'true' : 'false';
  }

  if (node.type === 'branch') {
    const data = node.data as { field: string; cases: { value: string }[] };
    const lead = enrollment.leadId ? await CrmcForumLeads.findByPk(enrollment.leadId) : null;
    const context = leadToConditionContext(lead);
    const actual = context[data.field];
    const matched = data.cases.find((c) => c.value === String(actual));
    return matched ? matched.value : 'default';
  }

  if (node.type === 'action.update_lead') {
    if (!enrollment.leadId) throw new Error('Cannot run action.update_lead on an enrollment with no lead');
    const data = node.data as { field: 'status' | 'assignTo' | 'region' | 'qualification_score'; value: string | number };
    await CrmcForumLeads.update({ [data.field]: data.value }, { where: { id: enrollment.leadId } });
    return undefined;
  }

  // crm_forum_leads_remarks is this CRM's actual lead-level note table
  // (verified via src/models/CrmcForumLeadsRemarks.ts before wiring this up -
  // NOT crm_task, which is opportunity-scoped, not lead-scoped, and so
  // doesn't fit a lead-enrollment's context at all). `emp` defaults to 0 at
  // the DB level for an automated/system-authored remark - no employee
  // actor to attribute it to.
  if (node.type === 'action.create_note') {
    if (!enrollment.leadId) throw new Error('Cannot run action.create_note on an enrollment with no lead');
    const data = node.data as { text: string };
    await CrmcForumLeadsRemarks.create({ lead: enrollment.leadId, remark: data.text, emp: 0, status: 1 });
    return undefined;
  }

  // crm_follow_up_reminders is this CRM's actual lead-level task/reminder
  // table (verified via src/models/CrmcFollowUpReminders.ts - again NOT
  // crm_task). Falls back to the lead's own assigned counselor
  // (crm_forum_leads.assignTo) when the node config doesn't specify an
  // assignee - a workflow-created task with nobody assigned would be
  // invisible in every "my tasks" view.
  if (node.type === 'action.create_task') {
    if (!enrollment.leadId) throw new Error('Cannot run action.create_task on an enrollment with no lead');
    const data = node.data as { title: string; dueInDays?: number; assigneeId?: number };
    const lead = await CrmcForumLeads.findByPk(enrollment.leadId);
    const assigneeId = data.assigneeId ?? lead?.assignTo ?? null;
    if (!assigneeId) throw new Error('action.create_task has no assigneeId and the lead has no assigned counselor to fall back to');
    const dueInDays = data.dueInDays ?? 1;
    await CrmcFollowUpReminders.create({
      lead_id: enrollment.leadId,
      user_id: assigneeId,
      reminder_date: new Date(Date.now() + dueInDays * 86_400_000),
      message: data.title,
    });
    return undefined;
  }

  if (node.type === 'bot.send_message') {
    const session = await CrmBotSessions.findOne({ where: { enrollmentId: enrollment.id } });
    if (!session) throw new Error('bot.send_message requires an active crm_bot_sessions row for this enrollment');
    const data = node.data as { text: string };
    await sendBotMessage(session, data.text);
    return undefined;
  }

  // Sends the template's currently PUBLISHED version only (never a draft),
  // rendered with the enrollment's own lead fields - not a per-campaign
  // variable_mapping (that concept belongs to crm_broadcast_campaigns, a
  // workflow enrollment has no such mapping to draw from).
  if (node.type === 'action.send_email_template') {
    if (!enrollment.leadId) throw new Error('Cannot run action.send_email_template on an enrollment with no lead');
    const data = node.data as { templateId: number };
    const lead = await CrmcForumLeads.findByPk(enrollment.leadId);
    if (!lead?.email) throw new Error('Lead has no email address to send to');
    const version = await loadPublishedTemplateVersion(data.templateId, 'email');
    const values = leadToTemplateVariables(lead);
    const components = version.components as EmailTemplateComponents;
    const subject = renderTemplateText(components.subject, values);
    const html = version.exportHtml ? renderTemplateHtml(version.exportHtml, values) : subject;
    await sendEmail({ to: lead.email, subject, html, text: subject });
    return undefined;
  }

  if (node.type === 'action.send_sms') {
    if (!enrollment.leadId) throw new Error('Cannot run action.send_sms on an enrollment with no lead');
    const data = node.data as { templateId: number };
    const lead = await CrmcForumLeads.findByPk(enrollment.leadId);
    if (!lead?.mobile) throw new Error('Lead has no mobile number to send to');
    const version = await loadPublishedTemplateVersion(data.templateId, 'sms');
    const values = leadToTemplateVariables(lead);
    const components = version.components as SmsTemplateComponents;
    const text = renderTemplateText(components.text, values);
    await sendSmsMessage({ to: lead.mobile, message: text, leadId: enrollment.leadId });
    return undefined;
  }

  if (node.type === 'action.assign_agent') {
    if (!enrollment.leadId) throw new Error('Cannot run action.assign_agent on an enrollment with no lead');
    const data = node.data as { agentId?: number; strategy?: 'round_robin' };
    const lead = await CrmcForumLeads.findByPk(enrollment.leadId);
    if (!lead) throw new Error('Lead not found for action.assign_agent');
    const oldAssignTo = lead.assignTo ?? null;

    let newAssignTo: number;
    if (data.strategy === 'round_robin') {
      // Calls into this CRM's real round-robin engine
      // (src/lib/assignmentRuleEngine.ts -> crm_lead_round_robin_state) -
      // the same one src/lib/webToLeadsIngest.ts and
      // src/app/api/lead-intake/route.ts already use, so a workflow-driven
      // assignment rotates through the exact same cursor/rules as every
      // other assignment path instead of a second, inconsistent algorithm.
      if (!lead.branch) throw new Error('Cannot round-robin assign a lead with no branch');
      try {
        const assignment = await resolveLeadAssignment({
          branchId: lead.branch,
          forceAutoAssign: true,
          roundRobin: true,
          sourceId: Number(lead.market_source) || null,
          priority: lead.priority,
          countryInterestId: Number(lead.country_interest) || null,
          serviceInterestId: Number(lead.service_interest) || null,
        });
        newAssignTo = assignment.assignedEmployeeId;
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        // Same "leave the lead as-is rather than fail" behavior as every
        // other round-robin caller - an empty branch roster must not fail
        // this workflow step (and there's nothing useful to assign to).
        if (!message.includes('No active employees are available')) throw error;
        return undefined;
      }
    } else {
      if (!data.agentId) throw new Error('action.assign_agent requires either agentId or strategy: round_robin');
      newAssignTo = data.agentId;
    }

    // Stamps the same transfer_date/transfer_time/transfered audit fields
    // and logs the same lead_assigned remark every other assignment path
    // does - a workflow-driven assignment must look identical to a manual
    // one everywhere else in the app that reads those fields.
    await recordLeadAssignment({
      leadId: enrollment.leadId,
      oldAssignTo,
      newAssignTo,
      actorId: null,
      actorRole: 'System (workflow automation)',
    });
    return undefined;
  }

  // crm_forum_leads.tags is a single free-text VARCHAR(500) column (verified
  // via src/models/CrmcForumLeads.ts and src/app/api/leads/[id]/route.ts,
  // which already reads/writes it as a plain string) - there is no separate
  // tags table in this CRM. Comma-separated is this handler's own
  // convention, since no existing code establishes one; case-insensitive
  // add/remove, case preserved on the value actually stored.
  if (node.type === 'action.add_tag' || node.type === 'action.remove_tag') {
    if (!enrollment.leadId) throw new Error(`Cannot run ${node.type} on an enrollment with no lead`);
    const data = node.data as { tag: string };
    const lead = await CrmcForumLeads.findByPk(enrollment.leadId);
    const currentTags = (lead?.tags ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const targetLower = data.tag.trim().toLowerCase();
    const nextTags = node.type === 'action.add_tag'
      ? (currentTags.some((t) => t.toLowerCase() === targetLower) ? currentTags : [...currentTags, data.tag.trim()])
      : currentTags.filter((t) => t.toLowerCase() !== targetLower);
    await CrmcForumLeads.update({ tags: nextTags.join(',') || null }, { where: { id: enrollment.leadId } });
    return undefined;
  }

  if (node.type === 'action.webhook') {
    const data = node.data as { url: string; method: 'GET' | 'POST' };
    if (!isWebhookHostAllowed(data.url)) {
      throw new Error(`Webhook host is not on WORKFLOW_WEBHOOK_ALLOWED_HOSTS - refusing to call ${new URL(data.url).hostname}`);
    }
    const lead = enrollment.leadId ? await CrmcForumLeads.findByPk(enrollment.leadId) : null;
    const res = await fetch(data.url, {
      method: data.method,
      headers: data.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: data.method === 'POST' ? JSON.stringify({ enrollmentId: enrollment.id, leadId: enrollment.leadId, lead: leadToTemplateVariables(lead) }) : undefined,
      signal: AbortSignal.timeout(15_000),
      // Never auto-follow a redirect: isWebhookHostAllowed() only validates
      // the URL configured on the node, and fetch's default 'follow' would
      // silently re-request whatever a 3xx response's Location header says,
      // bypassing the allowlist entirely if the (allowlisted) host is later
      // compromised or itself proxies to an attacker-influenced target.
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`Webhook call was refused: server responded with a redirect (${res.status}), which is not followed`);
    }
    if (!res.ok) throw new Error(`Webhook call failed: ${res.status} ${res.statusText}`);
    return undefined;
  }

  throw new NotImplementedNodeError(node.type);
}

type ConditionGroupLike = Parameters<typeof evaluateConditionGroup>[0];

function leadToConditionContext(lead: CrmcForumLeads | null): ConditionContext {
  if (!lead) return {};
  return {
    status: lead.status,
    branch: lead.branch,
    region: lead.region,
    assignTo: lead.assignTo,
    qualification_score: lead.qualification_score,
  };
}

// Variable values for rendering a template's {{name}} tokens
// (src/lib/broadcastTemplateRender.ts) from a workflow enrollment's lead -
// separate from leadToConditionContext() above, which feeds the condition
// evaluator instead and has different fields/types (numbers, not strings).
function leadToTemplateVariables(lead: CrmcForumLeads | null): Record<string, string> {
  if (!lead) return {};
  const values: Record<string, string> = {};
  if (lead.fname) values.first_name = lead.fname;
  if (lead.lname) values.last_name = lead.lname;
  if (lead.email) values.email = lead.email;
  if (lead.mobile) values.mobile = lead.mobile;
  return values;
}

// Loads a template's currently PUBLISHED version - a workflow action must
// never send a draft. Throws with a clear reason if the template has no
// published version, matching this file's "never fabricate a send" stance.
async function loadPublishedTemplateVersion(templateId: number, expectedChannel: 'email' | 'sms'): Promise<CrmMessageTemplateVersions> {
  const template = await CrmMessageTemplates.findByPk(templateId);
  if (!template) throw new Error(`Template ${templateId} not found`);
  if (template.channel !== expectedChannel) throw new Error(`Template ${templateId} is a ${template.channel} template, not ${expectedChannel}`);
  if (!template.currentPublishedVersionId) throw new Error(`Template ${templateId} ("${template.name}") has no published version`);
  const version = await CrmMessageTemplateVersions.findByPk(template.currentPublishedVersionId);
  if (!version) throw new Error(`Published version for template ${templateId} no longer exists`);
  return version;
}

// Reconciliation sweep - not the primary path (BullMQ is, see file header).
// Runs at a reduced cadence from src/lib/workflow-runtime-cron.ts.
export async function processDueWorkflowSteps(limit = 20): Promise<WorkflowRuntimeTickResult> {
  const steps = await claimDueSteps(limit);
  const result: WorkflowRuntimeTickResult = { claimed: steps.length, advanced: 0, waiting: 0, failed: 0 };
  for (const step of steps) {
    const outcome = await executeStep(step);
    result[outcome === 'advanced' ? 'advanced' : outcome === 'waiting' ? 'waiting' : 'failed'] += 1;
  }
  return result;
}

// Called by the BullMQ worker for a 'wait_deadline' job. Only meaningful
// for a wait still 'waiting' at its deadline - if resumeWaitForEvent()
// already resolved it (a reply arrived before the timeout), this job finds
// the row already 'resumed' and does nothing, exactly the deduplication
// this needs given BullMQ can't be told to cancel an already-scheduled
// delayed job for a wait that resolved early. Not a fully atomic
// claim (a genuine race between this and resumeWaitForEvent() for the same
// wait is possible but vanishingly unlikely for this workload); an atomic
// UPDATE...WHERE status='waiting' claim is the natural upgrade if that ever
// changes.
export async function resolveWaitById(waitId: number): Promise<boolean> {
  const wait = await CrmWorkflowWaits.findByPk(waitId);
  if (!wait || wait.status !== 'waiting') return false;
  await advanceFromWait(wait, wait.waitType === 'event' ? 'timeout' : undefined);
  return true;
}

// Reconciliation sweep - not the primary path (BullMQ is, see file header).
// Runs at a reduced cadence from src/lib/workflow-runtime-cron.ts.
export async function resolveDueWaits(limit = 20): Promise<number> {
  const dueWaits = await CrmWorkflowWaits.findAll({
    where: { status: 'waiting', deadlineAt: { [Op.lte]: new Date() } },
    limit,
  });

  for (const wait of dueWaits) {
    await advanceFromWait(wait, wait.waitType === 'event' ? 'timeout' : undefined);
  }
  return dueWaits.length;
}

export interface ResumeEventPayload {
  /** The inbound message's raw text - used by bot.quick_reply to pick its branch and by bot.ask_question to fill its captureField. */
  text?: string | null;
}

// Called by inbound event processing (src/app/api/webhooks/whatsapp/route.ts)
// with the same correlation key computed by
// waitEventCorrelationKey(enrollmentId, eventType). Resolves the matching
// still-waiting wait row down its 'resumed' edge.
export async function resumeWaitForEvent(eventCorrelationKey: string, payload?: ResumeEventPayload): Promise<boolean> {
  const wait = await CrmWorkflowWaits.findOne({ where: { eventCorrelationKey, status: 'waiting' } });
  if (!wait) return false;
  await advanceFromWait(wait, 'resumed', payload);
  return true;
}

async function advanceFromWait(wait: CrmWorkflowWaits, forcedHandle?: 'resumed' | 'timeout', payload?: ResumeEventPayload) {
  const step = await CrmWorkflowStepExecutions.findByPk(wait.stepExecutionId);
  if (!step) return;
  const enrollment = await CrmWorkflowEnrollments.findByPk(wait.enrollmentId);
  if (!enrollment || enrollment.status === 'cancelled') {
    await wait.update({ status: 'cancelled' });
    return;
  }

  const version = await CrmWorkflowVersions.findByPk(enrollment.workflowVersionId);
  if (!version) return;
  const graph = getGraph(version);
  const node = findNode(graph, step.nodeId);
  const outgoing = findOutgoingEdges(graph, node.id);
  let nextHandle: string | undefined = forcedHandle;

  if (forcedHandle === 'resumed' && node.type === 'bot.quick_reply') {
    const data = node.data as { options: { value: string; label: string }[] };
    const text = (payload?.text ?? '').trim().toLowerCase();
    // Matches by label, value, or numeric position (the message this node
    // sends lists options as "1. Label" - see createWaitRow), whichever the
    // user actually typed back.
    const matchedIndex = data.options.findIndex((o, i) => o.label.toLowerCase() === text || o.value.toLowerCase() === text || String(i + 1) === text);
    nextHandle = matchedIndex >= 0 ? data.options[matchedIndex].value : 'timeout';
  } else if (forcedHandle === 'resumed' && node.type === 'bot.ask_question') {
    const data = node.data as { captureField: string };
    const session = await CrmBotSessions.findOne({ where: { enrollmentId: enrollment.id } });
    if (session) {
      const sessionState = (session.sessionState as Record<string, unknown> | null) ?? {};
      await session.update({ sessionState: { ...sessionState, [data.captureField]: payload?.text ?? null } });
    }
    nextHandle = undefined; // bot.ask_question has a single continuation edge, no branching
  }

  const matchingEdges = nextHandle === undefined ? outgoing : outgoing.filter((e) => (e.sourceHandle ?? '') === nextHandle);

  await wait.update({ status: forcedHandle === 'timeout' ? 'timed_out' : 'resumed', resumedAt: new Date() });
  // The enrollment was parked 'waiting' when this wait's step created it
  // (see executeStep's wait branch) - it's active again the moment we
  // resume, even before the next step_execution is actually claimed/run.
  await enrollment.update({ status: 'active' });
  await dispatchNextSteps(graph, enrollment.id, matchingEdges);
}
