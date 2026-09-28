# Broadcast Center — Remaining Work

Companion to [`broadcast-architecture.md`](./broadcast-architecture.md) (the phase-by-phase build log). This is the forward-looking punch list: everything still outstanding as of commit `79d5dc1`, grouped by whether it can be picked up right now or is blocked on something external.

## Blocked — need a decision or credentials from you

### 1. WhatsApp template sending
`action.send_whatsapp_template` and cold-broadcast WhatsApp campaigns are schema-complete and preflight-gated (`checkTemplateApprovedForLaunch()` in `src/lib/broadcastPreflight.ts` refuses to launch an unapproved template) but cannot actually submit a template to Meta for approval or send one. Needs:
- A real WhatsApp Business Account (WABA) with Meta app review completed
- Live credentials in `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` (`.env.example` already documents both)
- The actual Graph API submission call (submit template → poll/webhook for approval status) — `crm_message_template_status_events` table already exists to record the result, just nothing writes to it yet

### 2. SMS provider integration
`src/lib/sms.ts`'s `sendSmsMessage()` exists as an interface but has no real provider wired in. Needs:
- A choice of provider (Twilio, Meta's own SMS product, a regional aggregator — your call)
- An account + API credentials
- The actual send-call implementation once a provider is picked

## Buildable now — no external dependency

### 3. Bot inbox / live-conversation UI
When `bot.handoff` fires, `crm_bot_sessions.status` flips to `'handed_off'` — and then nothing. There's no screen for a human agent to:
- See which sessions are waiting for a human
- Read the conversation history (`crm_bot_messages` already has it)
- Reply directly, taking over from the bot

Would need a new admin page + an API route to list/read/reply to handed-off sessions. Reasonable to scope as its own page under `/admin/broadcast/` alongside the existing templates/campaigns/workflows screens.

### 4. Dry-run simulator / per-node execution history UI
Two related, currently-missing pieces:
- **Dry-run simulator**: preview how a workflow graph would execute for a sample lead, before publishing it for real
- **Execution history UI**: `crm_workflow_step_executions` already records every step's status/timing/error per enrollment — the analytics dashboard (`/admin/broadcast/analytics`) only shows aggregate counts across all enrollments, not a per-enrollment timeline. Would need a detail view (e.g. `/admin/broadcast/workflows/[id]/enrollments/[enrollmentId]`) showing each step in order with its status and any error.

Both are net-new UI surfaces, not bug fixes — worth confirming priority/order before building, since they're a meaningful chunk of work each.

## Done since this doc was first written
**Visual segment builder** - `/admin/broadcast/segments/[id]` (create at `.../new`, edit at `.../<id>`): a recursive AND/OR filter builder over the same field/operator allowlist the server validates against, with live dropdowns for branch/region/status/assigned-to (reusing the existing `/api/lead-filter-options` and `/api/employees/active` endpoints - no new backend data work) and a live "Estimate recipients" count. Verified end-to-end in-browser: create, edit (existing filter loads correctly into the builder, including a multi-value "is one of" condition and a nested OR group), and delete, against real data (non-zero, accurate recipient counts) - not just typechecked.

## Explicitly checked and NOT a gap
Two other files matched `INSERT INTO crm_forum_leads` during the raw-INSERT audit (§13 of the architecture doc) but turned out to be dead/unreferenced debug scaffolding, not real lead-creation paths: `src/app/api/admin/leads-crud/route.ts` and `src/app/api/admin/leads-crud-working/route.ts`. Zero frontend references, no duplicate/branch-resolution logic unlike every real intake path, and the code's own `GET` handler already says synthetic tests are disabled. Left alone rather than wired up or deleted — noted here so they don't get re-flagged as a gap later.

## Everything else is done and validated
Schema, models, template library (incl. Unlayer), segments, campaign builder + launch preflight + BullMQ send worker with quotas, workflow engine (React Flow canvas, graph validator, condition evaluator, runtime with wait/resume), bot flow nodes wired to the WhatsApp webhook, all 6 trigger types firing from real CRM events (including two previously-invisible lead-creation paths found by audit), `assign_agent` round-robin integrated with the CRM's existing rotation engine, analytics dashboard, and a 5-finding security review with fixes (SSRF-via-redirect, HTML injection into outbound emails, segment/campaign IDOR, cross-branch IDOR, client-controlled branchId). All validated via `tsc --noEmit`, `eslint`, 196/196 unit tests, and a production `next build` — see `broadcast-architecture.md` for the full history.
