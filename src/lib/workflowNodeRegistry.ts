import { z } from 'zod';

// Registry of every node type the visual workflow builder (Phase 4) and bot
// builder (Phase 5, via crm_workflow_definitions.workflow_type='bot') can
// place on the React Flow canvas. Each entry is pure data/schema - there is
// no `eval`/`new Function`/arbitrary-code path anywhere in this registry or
// in how a workflow graph is validated, matching the spec's "Do not execute
// arbitrary JS from user-authored workflow JSON" rule structurally, not
// just by convention: a node's `data` is only ever parsed against its own
// fixed Zod schema below, never interpreted as code.

export type WorkflowNodeCategory = 'trigger' | 'condition' | 'wait' | 'action' | 'control';

export interface WorkflowNodeTypeDef {
  type: string;
  category: WorkflowNodeCategory;
  configSchema: z.ZodTypeAny;
  /** Incoming edges this node type accepts. Triggers are graph roots (0). */
  allowsIncoming: boolean;
  /** Exact outgoing-edge handle labels this node requires, e.g. a condition needs both 'true' and 'false'. Undefined = a single unlabeled edge. */
  outgoingHandles?: string[];
  /** Terminal node - must have zero outgoing edges (goal/end). */
  isTerminal?: boolean;
}

const leadFieldUpdateSchema = z.object({
  field: z.enum(['status', 'assignTo', 'region', 'qualification_score']),
  value: z.union([z.string(), z.number()]),
});

const conditionSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.enum(['and', 'or']),
    conditions: z.array(z.union([
      z.object({
        field: z.string().min(1),
        operator: z.enum(['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']),
        value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
      }),
      conditionSchema,
    ])).min(1).max(50),
  })
);

export const WORKFLOW_NODE_TYPES: Record<string, WorkflowNodeTypeDef> = {
  // ── Triggers (graph roots - no incoming edges) ──────────────────────────
  'trigger.lead_created': { type: 'trigger.lead_created', category: 'trigger', allowsIncoming: false, configSchema: z.object({ branchId: z.number().optional() }) },
  'trigger.lead_updated': { type: 'trigger.lead_updated', category: 'trigger', allowsIncoming: false, configSchema: z.object({ watchedFields: z.array(z.string()).optional() }) },
  'trigger.stage_changed': { type: 'trigger.stage_changed', category: 'trigger', allowsIncoming: false, configSchema: z.object({ fromStage: z.string().optional(), toStage: z.string().optional() }) },
  'trigger.form_submitted': { type: 'trigger.form_submitted', category: 'trigger', allowsIncoming: false, configSchema: z.object({ formKey: z.string().min(1) }) },
  'trigger.inbound_message': { type: 'trigger.inbound_message', category: 'trigger', allowsIncoming: false, configSchema: z.object({ channel: z.enum(['whatsapp', 'sms']) }) },
  'trigger.campaign_event': { type: 'trigger.campaign_event', category: 'trigger', allowsIncoming: false, configSchema: z.object({ campaignId: z.number().optional(), eventType: z.enum(['sent', 'delivered', 'read', 'replied', 'bounced', 'opted_out']) }) },
  'trigger.manual': { type: 'trigger.manual', category: 'trigger', allowsIncoming: false, configSchema: z.object({}) },
  'trigger.schedule': { type: 'trigger.schedule', category: 'trigger', allowsIncoming: false, configSchema: z.object({ cronExpression: z.string().min(1), timezone: z.string().min(1) }) },

  // ── Condition / control flow ─────────────────────────────────────────────
  'condition': { type: 'condition', category: 'condition', allowsIncoming: true, outgoingHandles: ['true', 'false'], configSchema: z.object({ root: conditionSchema }) },
  'branch': { type: 'branch', category: 'condition', allowsIncoming: true, configSchema: z.object({ field: z.string().min(1), cases: z.array(z.object({ value: z.string(), label: z.string() })).min(2) }) },
  'human_approval': { type: 'human_approval', category: 'control', allowsIncoming: true, outgoingHandles: ['approved', 'rejected'], configSchema: z.object({ approverRole: z.string().optional(), instructions: z.string().optional() }) },
  'goal': { type: 'goal', category: 'control', allowsIncoming: true, isTerminal: true, configSchema: z.object({ goalName: z.string().min(1) }) },
  'end': { type: 'end', category: 'control', allowsIncoming: true, isTerminal: true, configSchema: z.object({}) },

  // ── Waits ─────────────────────────────────────────────────────────────────
  'wait.duration': { type: 'wait.duration', category: 'wait', allowsIncoming: true, configSchema: z.object({ amount: z.number().positive(), unit: z.enum(['minutes', 'hours', 'days']) }) },
  'wait.until': { type: 'wait.until', category: 'wait', allowsIncoming: true, configSchema: z.object({ isoDatetime: z.string().datetime().optional(), leadDateField: z.string().optional() }).refine((v) => v.isoDatetime || v.leadDateField, 'Either isoDatetime or leadDateField is required') },
  'wait.for_event': { type: 'wait.for_event', category: 'wait', allowsIncoming: true, outgoingHandles: ['resumed', 'timeout'], configSchema: z.object({ eventType: z.string().min(1), timeoutMinutes: z.number().positive() }) },

  // ── Actions (single continuation edge) ───────────────────────────────────
  'action.send_whatsapp_template': { type: 'action.send_whatsapp_template', category: 'action', allowsIncoming: true, configSchema: z.object({ templateId: z.number() }) },
  'action.send_email_template': { type: 'action.send_email_template', category: 'action', allowsIncoming: true, configSchema: z.object({ templateId: z.number() }) },
  'action.send_sms': { type: 'action.send_sms', category: 'action', allowsIncoming: true, configSchema: z.object({ templateId: z.number() }) },
  'action.update_lead': { type: 'action.update_lead', category: 'action', allowsIncoming: true, configSchema: leadFieldUpdateSchema },
  'action.assign_agent': { type: 'action.assign_agent', category: 'action', allowsIncoming: true, configSchema: z.union([z.object({ agentId: z.number() }), z.object({ strategy: z.literal('round_robin') })]) },
  'action.add_tag': { type: 'action.add_tag', category: 'action', allowsIncoming: true, configSchema: z.object({ tag: z.string().min(1) }) },
  'action.remove_tag': { type: 'action.remove_tag', category: 'action', allowsIncoming: true, configSchema: z.object({ tag: z.string().min(1) }) },
  'action.create_task': { type: 'action.create_task', category: 'action', allowsIncoming: true, configSchema: z.object({ title: z.string().min(1), dueInDays: z.number().optional(), assigneeId: z.number().optional() }) },
  'action.create_note': { type: 'action.create_note', category: 'action', allowsIncoming: true, configSchema: z.object({ text: z.string().min(1) }) },
  // SSRF-safe: url must be https and its hostname must be on the explicit
  // allowlist below - never an arbitrary client-supplied host (which could
  // otherwise be used to probe internal/private network addresses from the
  // server that runs this workflow).
  'action.webhook': {
    type: 'action.webhook',
    category: 'action',
    allowsIncoming: true,
    configSchema: z.object({
      url: z.string().url().refine((url) => new URL(url).protocol === 'https:', 'Webhook URL must use https'),
      method: z.enum(['GET', 'POST']).default('POST'),
    }),
  },

  // ── Bot flow nodes (Phase 5 - conversational bots, workflow_type='bot') ──
  // These use the exact same graph/runtime/versioning machinery as
  // 'automation' workflows - only these three node types are genuinely
  // bot-specific. Plain text sending is correct here (unlike
  // action.send_whatsapp_template's approved-template requirement for cold
  // broadcast): a bot node only ever fires inside an already-active,
  // user-initiated conversation, squarely inside Meta's 24h customer-service
  // window - see src/lib/whatsapp.ts's own note on that constraint.
  'bot.send_message': {
    type: 'bot.send_message',
    category: 'action',
    allowsIncoming: true,
    configSchema: z.object({ text: z.string().min(1).max(4096) }),
  },
  // Sends `question`, then waits for the next inbound reply and stores its
  // raw text into crm_bot_sessions.session_state[captureField] - the next
  // node downstream reads that field via a condition/branch node.
  'bot.ask_question': {
    type: 'bot.ask_question',
    category: 'wait',
    allowsIncoming: true,
    configSchema: z.object({
      question: z.string().min(1).max(4096),
      captureField: z.string().min(1),
      timeoutMinutes: z.number().positive().default(1440),
    }),
  },
  // Sends `text` with up to 3 quick-reply buttons (WhatsApp's own button
  // limit) and branches on which one the user picks - the branch handles
  // come from `options` (validated in workflowGraphValidator.ts, same
  // pattern as the automation 'branch' node), plus a 'timeout' handle.
  'bot.quick_reply': {
    type: 'bot.quick_reply',
    category: 'wait',
    allowsIncoming: true,
    configSchema: z.object({
      text: z.string().min(1).max(1024),
      options: z.array(z.object({ value: z.string().min(1), label: z.string().min(1).max(20) })).min(1).max(3),
      timeoutMinutes: z.number().positive().default(1440),
    }),
  },
  // Ends the bot's control of the conversation - a human agent takes over
  // from here (crm_bot_sessions.status -> 'handed_off'). Terminal: nothing
  // downstream in the graph runs after a handoff.
  'bot.handoff': {
    type: 'bot.handoff',
    category: 'control',
    allowsIncoming: true,
    isTerminal: true,
    configSchema: z.object({ reason: z.string().optional() }),
  },
};

export function getNodeTypeDef(type: string): WorkflowNodeTypeDef | undefined {
  return WORKFLOW_NODE_TYPES[type];
}

// Hostnames a workflow's webhook action may call. Enforced at execution
// time (not just schema validation, since DNS can change after a workflow
// is published) by the Phase 4 runtime - listed here because it is part of
// the same "never let user-authored config reach an arbitrary network
// destination" contract as the schema's https-only check above.
export const WEBHOOK_HOST_ALLOWLIST: readonly string[] = [
  // Intentionally empty by default - a deployment opts specific
  // integration partners in via env var (WORKFLOW_WEBHOOK_ALLOWED_HOSTS,
  // comma-separated) rather than this codebase guessing what's safe.
];

export function isWebhookHostAllowed(url: string): boolean {
  const allowlist = (process.env.WORKFLOW_WEBHOOK_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return allowlist.includes(hostname);
  } catch {
    return false;
  }
}
