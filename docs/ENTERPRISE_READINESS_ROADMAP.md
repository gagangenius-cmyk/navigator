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

## Phase 2 — Reliability Infrastructure (not started)

**Open decision needed before starting**: async job processing via (a) a DB-backed queue
table polled by the existing `node-cron` heartbeat in `src/instrumentation.ts` — zero new
infra — or (b) Redis + BullMQ. Recommend (a) unless Redis is already available in the
deployment environment.

1. Move `src/lib/mailer.ts` (Resend) sends and Pusher notification fan-out off the
   synchronous request path onto the queue, with retry + a "failed jobs" admin view.
2. Give `lead-pool-sla-cron.ts` / renewal reminders / monthly report scan visible run
   history instead of silent no-ops.
3. Baseline test suite: configure the already-present (unconfigured) Playwright
   devDependency for a few critical end-to-end flows (login+MFA, lead → opportunity →
   payment) + lightweight unit tests around money-critical pure functions (fee/
   exchange-rate calc, discount-approval state machine). **Ask which flow breaks most
   often** (recent git history shows repeated "bug fixed" commits) to target the
   highest-ROI regression test first.
4. Add `error.tsx`/`global-error.tsx` under `src/app/admin` if not already present.

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
