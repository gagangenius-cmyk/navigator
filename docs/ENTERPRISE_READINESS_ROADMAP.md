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

## Phase 3 — Client Communication & AI Assist (not started)

**Open decisions needed before starting**:
- WhatsApp send: Meta WhatsApp Cloud API vs. Twilio/MSG91?
- AI features: which LLM provider/API key is authorized, and is a vision-capable model
  acceptable for document OCR or is a dedicated OCR service preferred?

1. Outbound WhatsApp/SMS send wired into the existing `ops-conversations` history, with
   a template-management page (reusing the `email-templates` page pattern).
2. `/admin/notifications` page (or header bell dropdown, if one doesn't already exist)
   surfacing `crm_notifications` with mark-as-read, using existing Pusher wiring.
3. AI-assisted features, in order of value-to-effort:
   - Passport/ID auto-fill via OCR on document upload.
   - Draft-remark/follow-up suggestions during the lead-remark flow.
   - Lead scoring — start with a heuristic/logistic-regression model over historical
     conversion fields before reaching for an LLM call.

---

## Sequencing

Land Phase 1 as its own reviewable change (no external dependency, closes the biggest
risk). Bring Phase 2's queue decision and Phase 3's vendor decisions back for a decision
before starting those phases.
