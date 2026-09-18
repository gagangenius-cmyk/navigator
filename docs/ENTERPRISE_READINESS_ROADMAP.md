# Enterprise-Readiness Roadmap

Gap-analysis and implementation plan produced from a full codebase review (module
inventory + architecture survey) plus 2026 enterprise-CRM / immigration-CRM market
research. Goal: harden this CRM against an "enterprise-grade" bar without adding
speculative features the business hasn't asked for.

## Baseline (already in place)

This is not a thin CRM. It already has: a full lead→opportunity→client pipeline with
20+ program-specific ops pipelines, contracts/e-signature, finance (invoices/payments/
PnL/discount & compliance approval workflows), HR (attendance/payroll/leave/
recruitment), a PRO/GCC labour-compliance module (WPS, insurance, renewals), a genuine
client-facing self-service portal, DB-backed granular RBAC (`crm_role`/`crm_permission`),
real TOTP MFA, multi-currency with per-branch exchange rates, Meta Lead Ads integration,
and report caching via Next.js tags.

## Gaps identified

1. **Security & audit hardening** — no central route gate for `/admin/*` (auth enforced
   per-route, ad hoc, inside ~260 handlers); no unified audit log for payments/RBAC/
   employee-account changes; rate limiting covered only 6 of ~260 API routes; error
   tracking wired into only ~11 files; upload validation trusted declared content-type
   with no malware scanning.
2. **Reliability infrastructure** — email/notifications send synchronously in-request
   with no retry; cron jobs run in-process with no failure visibility; **zero automated
   tests** exist anywhere in the repo.
3. **Client communication & AI assist** — WhatsApp/SMS activity is only logged, never
   sent, from the CRM; no dedicated notification-center page; no AI-assisted features
   (lead scoring, drafting suggestions, passport/ID OCR auto-fill).

Sources: [Salesmate — Best Enterprise CRM Software 2026](https://www.salesmate.io/blog/best-enterprise-crm-software/),
[Bedrock — CRM Compliance & Evaluation Checklist](https://bedrockfs.com/best-crm-feature-checklist-compliance-and-evaluation-guide-for-advisors/),
[ApptoCase — Ultimate Guide to Immigration CRM 2026](https://apptocase.com/ultimate-guide-to-immigration-crm/),
[SmartX CRM — Visa/Immigration CRM Guide 2026](https://smartxcrm.com/visa-immigration-crm-software-complete-guide-to-transform-your-immigration-consultancy-in-2026/),
[Creatio — AI CRM Glossary](https://www.creatio.com/glossary/ai-crm),
[Zylo — SaaS Compliance Checklist 2026](https://zylo.com/blog/saas-compliance-checklist).

---

## Phase 1 — Security & Audit Hardening (done, first pass)

| # | Item | Status | Files |
|---|------|--------|-------|
| 1 | Central route gate | ✅ Done | `src/proxy.ts` (Next.js 16 renamed `middleware.ts` → `proxy.ts`; must export `proxy`, not `middleware`) — verifies the `auth-token` JWT via `jose` (edge-safe) before any `/admin/:path*` request reaches the page shell. Rejects client-portal tokens (`principalType:'client'`). Verified: no cookie → redirect; garbage token → redirect; valid staff token → pass; client-portal token → redirect; unrelated routes (`/`, `/api/leads`) unaffected. |
| 2 | Unified audit log | ✅ Done, first batch of call sites | `src/lib/auditLog.ts` (new `logAudit()`, self-migrating `crm_audit_log` table, same fire-and-forget contract as `logLeadRemark`/`logDataAccess`). Viewer: `src/app/admin/audit-log/page.tsx` + `src/app/api/audit-log/route.ts` (GET-only — audit trail must never be editable via its own API). Nav entry added to `DashboardLayout.tsx`, route permission added to `roleAccess.ts` (`roles.manage`/`admin.access`). Wired into: payment verify/reject (`opportunity-payments/verify`), role-permission changes (`admin/roles/[id]/permissions`), employee role/status/branch changes + deactivation + password resets (`admin/employees/*`), discount approval decisions + CEO delete (`discount-approvals/[id]`), compliance approval decisions (`opportunity-compliance-approvals`). Verified end-to-end against the real DB: table auto-creates, page + API both gate correctly, empty state renders. Not yet wired into every mutating route in the app — this covers the payments/RBAC/employee/approval paths identified as highest-risk; extend the same pattern (`logAudit(...)` after a successful write) to other sensitive routes as they come up. |
| 3 | Broaden rate limiting | ✅ Done, first batch | Added (on top of the existing 6 routes) to: employee password-reset (`admin/employees/reset-password`, keyed by admin id), payment verify/reject (`opportunity-payments/verify`, keyed by accountant id), and leads Excel export (`api/leads?exportType=excel`, keyed by actor id — the one unpaginated full-PII-dump endpoint). All throttle by actor id, not IP, since these are authenticated-session actions where the threat is a compromised/scripted session, not anonymous brute force. |
| 4 | Broaden error tracking | ✅ Done, first batch | `captureError()` added to every route touched above (payments verify, role-permissions, employees PUT/DELETE, reset-password, discount-approvals GET/PUT/DELETE, compliance-approvals POST/PUT, audit-log GET). Not yet swept across the full ~260 routes — deliberately scoped to money/RBAC/audit paths first. |
| 5 | Upload validation hardening | ✅ Done (revised approach) | **Discovered mid-implementation**: `src/app/api/blob/upload/route.ts` is a direct-to-Blob token broker (browser uploads bytes straight to Vercel Blob) — this server *never sees the file bytes* at upload time, so pre-upload magic-byte sniffing (the original plan) is architecturally impossible here without removing the direct-to-blob design entirely (which exists specifically to bypass Next.js's ~4.5MB request-body limit). Implemented instead: `onUploadCompleted` now fetches the first 16 bytes of the stored blob via a ranged request, checks them against the real file signature for the declared content-type (PDF/JPEG/PNG/GIF/WEBP/DOC/DOCX/XLSX), and `del()`s the blob + audit-logs it if they don't match. Fails open on any fetch error. **Known limitation, inherited from the existing code's own prior comment**: `onUploadCompleted` only fires when Vercel Blob can reach the app over the public internet — it does not fire in local dev, only in a deployed environment. True antivirus scanning (vs. type-mismatch detection) would still need an external service (ClamAV/VirusTotal) — a separate decision, not built here. |
| 6 | CSRF | ✅ Verified, no action needed | Cookie is already `httpOnly` + `secure` (prod) + `SameSite=Lax` (`src/app/api/auth/login/route.ts`), and no wildcard CORS exists on any staff-authenticated route (only the intentionally-public lead-intake endpoints set `Access-Control-Allow-Origin`). Combined, this already blocks the standard CSRF vectors — no CSRF-token system needed. |

**Verification**: dev server smoke-tested against the real (remote) dev database — unauthenticated `/admin/leads` and `/admin/audit-log` → 307 to `/login`; valid staff JWT → 200 on both; client-portal JWT → redirected; garbage token → redirected; `/`, `/api/leads` (list), and `/api/audit-log` all behave correctly. `npx tsc --noEmit` clean after every batch of edits. Mutating endpoints (payment verify, employee update, discount/compliance approval) were **not** exercised live against the shared dev database to avoid touching real records — verified by type-checking and code review instead.

---

## Phase 2 — Reliability Infrastructure (done)

**Queue decision**: confirmed no Redis/ioredis/bullmq anywhere in this project (checked
`node_modules`, `.env`) — went with (a), a DB-backed queue table polled by the existing
`node-cron` heartbeat. Zero new infrastructure to provision or operate.

| # | Item | Status | Files |
|---|------|--------|-------|
| 1 | Async job queue | ✅ Done | `src/lib/jobQueue.ts` (new `crm_job_queue` table, self-migrating; `enqueueJob()`, `processDueJobs()` with exponential backoff up to 5 attempts, `retryFailedJob()`, `getJobQueueSummary()`). `src/lib/job-queue-cron.ts` (new — runs every minute via `node-cron`, registers the `send_email` handler wrapping the existing `sendEmail()` in `mailer.ts`). Wired into `src/instrumentation.ts` alongside the other 3 cron starts. Migrated the two email call sites that were pure fire-and-forget with no synchronous status dependency: `hr-joining-exit-service.ts`'s workflow notifications and `client-portal-service.ts`'s client emails. **Deliberately left un-migrated**: `monthly-report-service.ts` and `hr-service.ts`'s password-reset email both return an immediate Sent/Failed status to their caller (an admin-visible per-recipient result list, and an `emailSent` flag HR relies on to know whether to manually share a reset password) — queuing them would make that immediate status inaccurate, a real behavior change beyond infra hardening. Revisit only if that's an accepted tradeoff. |
| 2 | Cron run visibility | ✅ Done | `src/lib/cronRunLog.ts` (new — self-migrating `crm_cron_run_log` table, `withCronRunLog()` wrapper records status/duration/detail per run). Wired into all 4 cron tasks (lead pool SLA sweep, renewal reminders, monthly report scan, job queue processor) — each `catch` block is unchanged, so existing console.error behavior is preserved, this is additive. |
| — | Failed-jobs / cron-history admin view | ✅ Done | `src/app/admin/system-jobs/page.tsx` + `src/app/api/system-jobs/route.ts` (GET for queue counts/recent jobs + cron run history, POST for the "Retry" action on a failed job — audit-logged via `logAudit()`). Nav entry + `roleAccess.ts` permission added, same `admin.access`/`roles.manage` gate as Audit Log. |
| 4 | Uncaught render errors get reported | ✅ Done | `src/app/error.tsx` already existed as a working boundary but only did `console.error` — now also POSTs to `/api/client-error-report` (mirroring `global-error.tsx`, which already did this), so segment-level client crashes reach Sentry via `captureError`, not just fatal root-layout failures. No new `error.tsx` needed under `/admin` — the root one already covers it (no more specific one exists to override it). |
| 3 | Baseline test suite | ✅ Done | User authorized running e2e tests directly against the shared dev DB (`crm_next`) — no separate test database exists. Added `@playwright/test` (the `playwright` package alone, already a devDependency, is just the browser-automation library — the actual test runner/`playwright.config.ts` convention needs `@playwright/test` too). `scripts/seed-e2e-test-user.js` (new, additive-only — never touches or retires any other employee row, unlike `seed-employees.js`) creates one dedicated CEO-role test account (`e2e_test_bot`); credentials live in `.env` (gitignored) as `E2E_TEST_USERNAME`/`E2E_TEST_PASSWORD`. `playwright.config.ts` (new) + `tests/e2e/fixtures.ts` (shared login helper, unique-email/-phone generators so re-runs don't collide with this app's real duplicate-lead detection) + `tests/e2e/login.spec.ts` (3 tests: valid login, invalid password rejected, unauthenticated `/admin/*` redirected — this last one exercises Phase 1's `src/proxy.ts` gate directly) + `tests/e2e/lead-creation.spec.ts` (creates a real lead through the actual UI, confirms it round-trips into the Lead List search). `npm run test:e2e` to run; `npm run db:seed:e2e-test-user` to (re)create the test account. All 4 tests pass, confirmed stable across repeated runs. |

**Verification**: dev server smoke-tested against the real dev DB — `job_queue_processor` cron confirmed running on its 1-minute schedule and logging a real row to `crm_cron_run_log` (`{"processed":0,"succeeded":0,"failed":0}`, `durationMs: 1521`); `/admin/system-jobs` and `/api/system-jobs` both gate and render correctly. `npx tsc --noEmit` clean after every batch of edits. Did not manufacture a job through a real business workflow to verify the retry/failure path live at the infra level (Phase 2 items 1/2) — verified by code review instead, consistent with Phase 1's approach to the same shared DB. The e2e suite (item 3) *did* run live and create real records: **leads #474, #475, #476 now exist in the dev DB**, named "Playwright AutomatedTestLead" with `@example.invalid` emails — easy to find and delete if you want them cleaned up; every future run adds one more with a fresh timestamp-based email/phone.

---

## Phase 3 — Client Communication & AI Assist (done)

**Decisions**: WhatsApp send → Meta WhatsApp Cloud API (user's call). AI features → Anthropic
(Claude) (user's call).

**Correction to this doc's own earlier survey**: item 2 below ("no dedicated notification
page") was wrong — `src/components/notifications/NotificationCenter.tsx` already exists,
is wired into `DashboardLayout.tsx`'s header, and is a fully real-time (Pusher), mark-as-read
notification bell covering `crm_notifications`. No gap here; dropped from scope.

| # | Item | Status | Files |
|---|------|--------|-------|
| 1 | WhatsApp send | ✅ Done | `src/lib/whatsapp.ts` (new — mirrors `mailer.ts`'s exact shape: `sendWhatsAppMessage()` over Meta's Cloud API via plain `fetch`, self-migrating `crm_whatsapp_delivery_log` table, throws a descriptive error when `WHATSAPP_ACCESS_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` aren't set). New route `src/app/api/leads/[id]/send-whatsapp` (rate-limited by actor, also writes a normal row to `crm_forum_leads_remarks` so it shows in the lead's existing Remarks history, and a `whatsapp_sent` entry to `crm_remarks` — new `LeadRemarkAction` value, also added to the Today's Activity tab's activity-types list). UI: a new "Send WhatsApp message from the CRM" button next to the existing wa.me click-to-chat link in `LeadManagement.tsx`'s row actions, opening a small self-contained modal (deliberately *not* folded into the existing `leadActionType` state machine — see the code comment on why). **Not** wired into `ops-conversations` — that page is an unrelated internal client-portal chat thread (`dm_client_conversations`), a different audience (needs client-portal login) from a WhatsApp send to a lead's real phone number; conflating the two would have been the wrong integration point. Verified live: sending against an unconfigured environment correctly fails with `"WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are not configured"` and logs it to `crm_whatsapp_delivery_log`; not-found-lead and missing-message cases both return the right error. |
| 2 | Notification center | ✅ Already existed | See correction above — no work needed. |
| 3a | AI: draft-remark suggestions | ✅ Done | `src/lib/anthropic.ts` (new — same plain-`fetch` pattern, defaults to Haiku since this is a short/cheap text task, `ANTHROPIC_MODEL` overridable). New route `src/app/api/leads/[id]/suggest-remark` (rate-limited — an LLM call has real per-request cost unlike most routes here) builds a prompt from the lead's last 10 `crm_remarks` activity rows plus basic lead fields, returns a 2-3 sentence draft. UI: a "Suggest" button (Claude icon) next to the Remark textarea in the Lead Action modal, visible only for the remark action type — fills the textarea, the counsellor edits/sends normally; nothing is auto-filed. Verified live: correctly returns 503 `"ANTHROPIC_API_KEY is not configured"` against this environment's current (unset) key. |
| 3b | AI: passport/ID OCR auto-fill | ✅ Done | User chose counsellor-side lead creation (not client-portal self-service) — there was no existing "upload a document → fill a form" flow anywhere to extend, so this is a new surface. `extractDocumentFields()` added to `src/lib/anthropic.ts` (vision call, defaults to Sonnet via a separate `ANTHROPIC_VISION_MODEL` override — extraction quality matters more than cost here, unlike the cheap Haiku-default text-suggestion path). New route `src/app/api/leads/extract-document` (same auth bar as `POST /api/leads` itself; rate-limited by actor; 10MB/JPEG-PNG-WEBP guardrails; sanitizes the model's JSON into exactly `{firstName, lastName, dateOfBirth, gender}` — never passes raw model output through). UI: a "Scan document" upload button on `/admin/leads/create`, above the Lead Information section — prefills those four fields (only ones this form actually has; it has no nationality/passport-number fields to extract into) and requires the counsellor to review/save normally, nothing is auto-submitted. Verified live: unconfigured environment correctly 503s with `"ANTHROPIC_API_KEY is not configured"`; unauthenticated request correctly 401s; create-lead page renders correctly with the new widget. |
| 3c | AI: lead scoring | ✅ Done (revised approach) | **Blocked the originally-planned approach**: checked `crm_opportunities` directly before building anything — it has zero rows. No lead has ever been recorded converting to a client through this pipeline, so there is no historical outcome to fit a logistic regression or empirical conversion-rate model against; that data genuinely doesn't exist yet. Flagged this to the user, who chose a transparent rule-based score instead (not statistical), grounded in what the real 459-row dataset actually looks like (also checked directly: `priority` is "Medium" for 458/459 rows and `lead_quality` is "Warm" for all 459 — both fields are effectively untriaged in practice, so the score leans on the two signals that actually vary: free-text `status` — most rows are legacy text like "no answer messaged on whatsapp" rather than the clean admin-configured Hot/Warm/Cold/Junk/Dead/DNP/Enrolled list, matched via substring rather than exact-match — and recency of logged activity). `src/lib/leadScore.ts` (`computeLeadScore()`, pure and unit-testable, returns a 0-100 score + Hot/Warm/Cold label + a plain-English `reasons` array so a counsellor sees *why*, not a black-box number; self-migrating `crm_lead_scores` table, separate from `crm_forum_leads` rather than an ALTER TABLE on it). `src/lib/lead-score-cron.ts` (new — every 30 minutes, wired into `instrumentation.ts` and `withCronRunLog` like the other 4 cron tasks). Surfaced as a small badge in **both** `LeadManagement.tsx` view modes (table/list and card — discovered mid-implementation that the pre-existing wa.me WhatsApp link, and this session's own new "Send WhatsApp" button, had only been added to the card view, so that button was added to the list view too while fixing this). Verified live: `crm_lead_scores` table auto-creates; a real INSERT + `GET /api/leads` round-trip confirmed the JOIN and JSON `reasons` column both serialize correctly end to end. |

**Verification**: dev server smoke-tested against the real dev DB. `npx tsc --noEmit` clean after every batch. All three new `.env` sections (`WHATSAPP_*`, `ANTHROPIC_*`) added as empty placeholders with setup comments, matching the existing Meta/Resend sections' style — every new capability here degrades to a clear, logged error rather than crashing when unconfigured, same contract as `mailer.ts`/`pusherServer.ts`/`errorTracking.ts`.

---

## Post-Phase-3: wired up the dormant Meta lead-quality feedback loop

Not part of the original gap analysis — a direct user request. Investigation found the
backend for this was already fully built (`src/lib/meta/lead-quality-feedback.ts`,
`src/lib/meta/conversions-api.ts`, the `crm_meta_quality_mappings` admin config at
`/admin/meta-leads/quality-mappings`, and `crm_forum_leads.meta_leadgen_id` populated by
the Meta webhook ingestion pipeline) and even had a dedicated `GET /api/meta-leads/quality-options`
route whose own comment said it "feeds the Meta Lead Quality dropdown on the lead status
form" — but no dropdown anywhere in the app actually called it, so the whole feature was
dead code in practice.

Wired a "Report to Meta as..." dropdown into every real place a lead's status can be
changed, each shown only when that specific lead has a `meta_leadgen_id` (a manually-created
walk-in lead never sees it):
- `LeadManagement.tsx`'s status-change modal (`leadActionType === 'status'`) — sends
  `metaLeadQuality` alongside the status update in the same `PUT /api/leads/{id}` call.
- `/admin/leads/[id]/edit` — same dropdown in the Status & Priority section, same PUT contract.
- Kanban drag-and-drop (`handleStatusChange` → `PUT /api/leads-simple/{id}`, which doesn't
  accept `metaLeadQuality`) — since a drag has no form to put a dropdown in, a small
  follow-up modal (`kanbanMetaPrompt`) appears after a successful drop for Meta-sourced
  leads only, offering to report the outcome via a separate `PUT /api/leads/{id}` call
  with just `{metaLeadQuality}`; skippable, never blocks the drag itself.

`meta_leadgen_id` added to the `Lead` type and to the main paginated leads-list SELECT in
`src/app/api/leads/route.ts` (the single-lead `GET /api/leads/[id]` already selected `l.*`,
so it needed no query change). Verified live: `/api/meta-leads/quality-options` returns the
5 configured labels; leads/Kanban/edit pages all render without error.

---

## Phase 4 — Enterprise AI Feature Expansion (done, all 6 items)

Direct user request, following an advisory discussion of what AI features this CRM could
reasonably add. Explicitly **excludes** three ideas that came up in that discussion —
predictive lead scoring (ML), pipeline revenue forecasting, payment/discount anomaly
detection — because they all need historical outcome data to train against, and (per
Phase 3 item 3c above) `crm_opportunities` has zero rows. Everything below is LLM-in-context
work instead: no training data required, same reasoning as the lead-scoring pivot.

**Package decision**: evaluated adopting `ai` + `@ai-sdk/anthropic` (Vercel AI SDK) for this
batch. Verdict: adopt it specifically where streaming genuinely matters (the client-portal
chatbot, item 6) rather than migrating everything - the 4 AI features already shipped in
Phase 3 work and are verified; rewriting working code for its own sake isn't worth the risk.
Not adopting a vector database (Qdrant is available in this environment but is genuinely
premature at 459 leads and per-conversation-bounded chatbot context - noted as the natural
upgrade path if either data volume or retrieval sophistication grows).

| # | Item | Status | Files |
|---|------|--------|-------|
| 1 | WhatsApp/email draft assist | ✅ Done | New route `src/app/api/leads/[id]/draft-message` (distinct from `suggest-remark` — drafts a message *to* the client, second person, vs. an internal note) — builds a prompt from the lead's last 6 `crm_remarks` rows plus an optional free-text "what's this about" intent. UI: a "Draft with AI" button + intent input added to the existing WhatsApp-send modal in `LeadManagement.tsx`, prefilling the message textarea (the counsellor still edits/sends). Not wired to email — this CRM has no generic "compose email to a lead" UI surface to extend; only WhatsApp send is a real outbound-to-client channel today. Verified live: 503s correctly when unconfigured. |
| 2 | Duplicate detection AI upgrade | ✅ Done | A judgment layer on top of `checkForFuzzyDuplicate()` (`src/lib/duplicateLeadCheck.ts`), not a replacement — that function's SOUNDEX+Levenshtein candidate narrowing keeps working exactly as before. New `src/lib/duplicateAiCheck.ts` (`checkDuplicatesWithAI()`) sends the same small candidate set (max 5) it already produces to Claude for a plain-English verdict accounting for transliteration/nicknames a numeric similarity score can't judge. Integrated as a **fire-and-forget hook inside `POST /api/leads`** (`checkDuplicatesWithAIInBackground`), not a synchronous call — the create-lead page navigates away almost immediately after showing its existing duplicate toast, so there'd be nowhere for a slower AI verdict to land; instead it logs onto the *matched* lead's own activity history (`logLeadRemark`, action `duplicate_detected`) for whoever owns that lead to see later. A standalone `POST /api/leads/check-duplicate-ai` route also exists for any future synchronous caller (e.g. a duplicate-review page), reusing the same lib function. Verified live: created a real test lead (`#481`) with a name 97% similar to 5 existing test leads — `checkForFuzzyDuplicate` correctly found all 5, the background AI hook fired, failed gracefully (unconfigured key), and logged the failure without affecting the `201` response at all. |
| 3 | Case handover summarization | ✅ Done | Found the real handover point: the required "Counselor Conversation Summary" field at the Agreement stage of `opportunity-flow-wizard.tsx` (min-character-enforced, feeds `crm_opportunity_handover_notes` — what operations/compliance actually reads when a case leaves sales). New route `src/app/api/leads/[id]/summarize-case` uses more history than the other two text features (20 `crm_remarks` rows vs. 6-10) since a handover needs to cover the whole relationship, not just the latest note; errors with 422 if the lead has no logged activity yet rather than fabricating one. UI: "Summarize with AI" button next to that textarea's label, prefills it - the counsellor still reviews/edits before the required-field validation lets them continue. Verified live: 503s correctly when unconfigured; the wizard page itself still renders correctly. |
| 4 | Document classification on upload | ✅ Done | Verification, not blocking - a client could click "Passport Copy" and accidentally upload the wrong file, and previously nothing would catch that before a human reviewer eventually noticed. `src/lib/documentClassification.ts` (`classifyDocumentMatch()`) reuses `extractDocumentFields()`'s generic vision-call-returns-JSON shape from the Phase 3 OCR feature rather than adding a near-duplicate. Wired as a fire-and-forget hook in `src/app/api/clientportal/upload/route.ts`, scoped to image MIME types only (most of this checklist is images; PDFs aren't image content blocks the same way and are left unchecked, not force-fit). Two new self-migrating columns on `crm_client_documents` (`ai_check_status`, `ai_check_note`, added via the same incremental-`ALTER TABLE`-if-missing pattern already used for `mandatory`/`accepted_formats` on that table) — never blocks or delays the upload itself, a false positive on a real passport would be a worse outcome than a false negative slipping to manual review. On a flagged mismatch, notifies the lead's counsellor/owner via the existing `notifyUser` hook. Surfaced as a small amber "AI: check this" badge (tooltip = the model's one-sentence reasoning) next to the document label in `/admin/clients`' existing document-review list — no new page. Verified live: type-checked clean; `/admin/clients` and the upload route's now-larger import surface both compile and the page still renders. |
| 5 | Contract/agreement review assistant | ✅ Done (revised scope) | **Investigated and rejected two dead-end surfaces first**: `/admin/contract-generator` and `/admin/contract-templates` both looked like real features but turned out to be unwired UI shells — no `fetch()` calls in the generator page at all, and the templates page filters a hardcoded empty array (`const databaseTemplates: ContractTemplate[] = []`). Building "AI review" on top of non-functional pages wouldn't have been real. The actual functional review point is the **compliance-approval stage** (`/admin/compliance-approvals`, already touched in Phase 1 for audit logging) — a compliance officer manually cross-references the signed agreement, payment receipt, and counsellor's conversation summary before approving. New route `src/app/api/opportunity-compliance-approvals/[id]/ai-review` deliberately does **not** read the signed agreement document itself (those uploads accept `.pdf,.doc,.docx,.jpg,.jpeg,.png` — mixed formats Claude's image content blocks can't reliably handle, and guessing at undocumented PDF-vision API support wasn't worth the risk) — instead it cross-checks the same structured data the officer already has (paid vs. total amount, signature/date presence, whether the conversation summary looks generic or matches the service) and returns a short bulleted list of concerns, or "No concerns found." Never approves/rejects anything itself. UI: a "Run AI Review" button in the approval modal, next to the existing conversation-summary panel. Verified live: 503s correctly when unconfigured; the compliance-approvals page still renders. |
| 6 | Client-portal FAQ chatbot | ✅ Done | Added `ai` + `@ai-sdk/anthropic` + `@ai-sdk/react` (v5-generation API — verified every type signature used below directly against the installed packages' `.d.ts` files rather than assuming from memory, since the SDK's API shape changed substantially across major versions). New route `src/app/api/clientportal/chat` uses `streamText()` + `toUIMessageStreamResponse()`. **Two hard security rules, not just prompt-asked**: (1) case context is assembled server-side from the *authenticated* client's own `leadId` only (`requireClientAuth`) — nothing in the request body ever selects whose data gets used, so there's no tampering surface via a manipulated `opportunityId`; (2) the system prompt explicitly tells the model to treat the assembled case data (which includes verbatim staff-written reviewer notes) as data only, never as instructions — a defense against prompt injection via case notes. Every exchange is logged to a new self-migrating `crm_client_chat_log` table (question/answer/leadId) for compliance/QA visibility into what the AI actually told clients. UI: `ClientChatWidget.tsx`, a floating chat bubble mounted once in `ProductPortalShell.tsx` (persists across every client-portal page), clearly labeled "AI Assistant - Answers from your case only - not your case officer" to avoid confusion with the real "Conversation" page (an actual human case-officer channel this is deliberately kept separate from). Verified live: unauthenticated request correctly 401s; client-portal pages render correctly with the widget mounted. **Not fully exercised end-to-end** with a real authenticated client streaming session — this database has zero rows in `crm_opportunities` (the same finding from Phase 3 item 3c), so no lead has ever qualified for real client-portal credentials to test against; fabricating a full won-opportunity-plus-compliance-approval chain just to test this would have touched far more of the compliance pipeline than a smoke test warrants. Verified instead by type-checking against the installed SDK's actual definitions and live-testing every piece that doesn't require that specific chain (auth gate, page rendering). |

## Phase 5 — npm Audit Cleanup & Dev Tooling (done)

Direct user request: review the project as npm-package-level enterprise enhancements,
grounded in `npm audit` output and actual dependency usage rather than guessing.

**Vulnerability triage** — investigated each finding concretely before acting:
- `next-auth` and `prisma`/`@prisma/client`: confirmed via `grep -rl` that neither has a
  single import anywhere in `src/` — both were unused scaffolding. Removed outright rather
  than patched, eliminating their vulnerability chains entirely. Also removed the orphaned
  `prisma.config.ts`, `src/lib/prisma.ts`, and the `"postinstall": "prisma generate"` script
  that depended on them.
- `xlsx` (SheetJS): two advisories (prototype pollution, ReDoS) with no upstream fix, and
  unlike most dependencies here it's fed **untrusted** input directly — the leads/employee
  bulk-upload endpoints parse whatever `.xlsx` a staff member uploads. Migrated all 7 usages
  (leads/employee Excel export, sample-template downloads, both bulk-upload import paths) to
  `exceljs`. New `src/lib/excelCompat.ts` (server) and `src/lib/excelClientExport.ts`
  (browser) replicate the exact `xlsx.utils` surface this codebase used
  (`sheet_to_json`/`json_to_sheet`/`write`/`SSF.parse_date_code`), including the Excel
  1900-leap-year-bug date-serial algorithm. Verified live: all 3 export endpoints produce
  valid, correctly-populated `.xlsx` files (spot-checked cell content); a full bulk-upload
  import round-trip (real POST → real DB row → verified fields including a numeric
  Excel-date-serial → correct calendar date → cleaned up afterward) confirmed the
  untrusted-input parsing path works correctly end to end.
- `npm audit fix` applied for patch/minor-safe bumps (`next`, `mysql2`, `jspdf`, `ws`,
  `@types/node`). **Not** forced: `exceljs`'s own `uuid` dependency (moderate, missing
  buffer-bounds-check when a `buf` argument is explicitly passed) — checked
  `node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js` directly; it only
  ever calls `uuidv4()` with no arguments, so the vulnerable code path is never exercised.
  npm's suggested fix would downgrade `exceljs` to `3.4.0`, a breaking major-version
  regression, for zero real risk reduction.
- Regression caught before commit: removing `next-auth` silently also removed `jose` (it was
  only present transitively via `next-auth`), but `src/proxy.ts` — the live Phase 1 admin
  auth gate — imports `jose` directly. Caught via `npx tsc --noEmit` before anything was
  committed; fixed by adding `jose` as its own explicit direct dependency.
- A second, unrelated TS error surfaced during the migration: `Buffer<ArrayBufferLike>` no
  longer structurally satisfies DOM's `BodyInit` under this project's current
  `@types/node`/TypeScript lib combination (`ArrayBufferView`'s generic now requires a
  non-shared `ArrayBuffer`, which Node's `Buffer` type doesn't guarantee) — a confirmed,
  reproducible ecosystem-wide typing gap (isolated and reproduced outside this codebase's own
  files), not something introduced by this migration. `jsonToSheetBuffer` now returns
  `Uint8Array` (unambiguous `BodyInit`, identical at runtime) and the 4 `NextResponse`
  construction sites cast at that single boundary with an explanatory comment.

**Dev tooling** (user opted into both):
- **Husky + lint-staged**: `.husky/pre-commit` runs `npx lint-staged`, configured in
  `package.json` to `eslint --fix` staged `.ts/.tsx/.js/.jsx` files before every commit.
- **Vitest**: `vitest.config.mts` (real `tests/unit/**/*.test.ts`, separate from the
  Playwright e2e suite in `tests/e2e/` which needs a running dev server and the shared DB —
  Vitest here never touches either). First two suites target genuinely pure,
  correctness-critical logic that had zero prior coverage: `parseExcelDateCode`
  (`tests/unit/excelCompat.test.ts` — the date-serial algorithm above, including the
  1900-leap-year-bug boundary) and the discount-tier approval logic
  (`tests/unit/discountApproval.test.ts` — `getDiscountTier`/`getDiscountPercentage`/
  `canApproveDiscountTier`, money- and approval-routing-critical). `npm test` runs the suite;
  `npm run test:watch` for local iteration.

## Sequencing

Land Phase 1 as its own reviewable change (no external dependency, closes the biggest
risk). Bring Phase 2's queue decision and Phase 3's vendor decisions back for a decision
before starting those phases.
