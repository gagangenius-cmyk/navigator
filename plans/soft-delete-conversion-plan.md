# Soft-Delete Conversion Plan

## Context

Today, 46 tables have at least one live code path that physically `DELETE`s rows (or Sequelize `.destroy()`s them). Two already carry a reusable soft-delete column (`crm_discount_approvals.isDeleted`, `crm_clients.is_deleted`); the other 44 have none. Separately, two rounds of FK fixes this session (`migrations/20260925_fix_lead_fk_cascade.sql`, `migrations/20260926_fix_dangerous_cascades.sql`) changed the most dangerous `ON DELETE CASCADE` relationships to `RESTRICT` — which stops silent data destruction, but means several existing "delete" buttons will now fail outright for any record with real history, rather than succeeding. Full soft-delete is the actual fix for that: nothing physically deletes, so the RESTRICT walls never get hit.

This plan sequences that conversion. It does **not** start with code changes — it's the sequencing document you asked for.

## The one big design decision: how reads get filtered

Converting a `DELETE` endpoint to `UPDATE ... SET is_deleted = 1` is the easy half. The hard half: every existing `SELECT` / `findAll` / `findOne` against that table needs to stop returning soft-deleted rows, or deleted leads/opportunities/etc. reappear everywhere — lists, dropdowns, reports, search. For the two highest-traffic tables this is a real amount of surface area (`crm_forum_leads`: ~27 ORM call sites + ~129 raw-SQL references across 54 files; `crm_opportunities`: ~9 ORM + ~55 raw references across 27 files). Two ways to handle it:

**Option A — patch every read site by hand.** Add `WHERE is_deleted = 0` (or the Sequelize equivalent) to every affected query. Fully explicit, no surprises, but ~80+ files for the two big tables alone, and it only takes one missed query to leak a deleted record back into a list.

**Option B — rename the table, replace it with a filtering view.** Rename `crm_forum_leads` → `crm_forum_leads_raw`, then `CREATE VIEW crm_forum_leads AS SELECT * FROM crm_forum_leads_raw WHERE is_deleted = 0`. Every existing `SELECT` (raw SQL or Sequelize) that references `crm_forum_leads` by name automatically only sees live rows — zero application-code changes needed on the read side. MySQL's simple single-table views are updatable, so existing `INSERT`/`UPDATE` statements against `crm_forum_leads` keep working unchanged too.
- Cost: every FK constraint that currently references `crm_forum_leads(id)` (there are ~15) must be dropped and re-pointed at `crm_forum_leads_raw(id)` instead, since MySQL FKs can't target a view. Mechanical but has to be done correctly and atomically.
- Caveat: a `DELETE` issued against the view still physically deletes the underlying row (MySQL doesn't support intercepting that with a trigger on a view) — so the ~7 existing lead-delete call sites still need to be rewritten to `UPDATE` regardless of which option you pick. Option B only removes the need to patch every *read* site, not the *delete* sites.

**Recommendation: Option B for `crm_forum_leads` and `crm_opportunities` only** (the two tables where the read-side fan-out is large enough that Option A's manual-patch risk is real). Every other table in scope has a small enough read footprint (single-digit to low-double-digit call sites per the audit) that Option A is simpler and safer to just do directly — introducing a view for a table with 3 read call sites isn't worth the added indirection.

## Column convention

New tables get `is_deleted TINYINT NOT NULL DEFAULT 0`, `deleted_at DATETIME NULL`, `deleted_by INT NULL` (who deleted it — worth having for an audit-conscious rollout). The 3 tables that already have a soft-delete column (`crm_discount_approvals`, `crm_clients`, and this session's own `crm_contracts`) keep their existing shape as-is — don't churn already-correct code; just wire their existing `DELETE` endpoints to set the flag instead of deleting.

## Scope, tiered by what's actually live and how much it costs

### Tier 1 — Core business entities (do first; real business/financial consequence today)

| Table | Why it's Tier 1 | Delete call sites | Read-side approach |
|---|---|---|---|
| `crm_forum_leads` | The central entity; 7 different live delete paths (`/api/leads`, `/api/leads/[id]`, `/api/leads-simple/[id]`, `/api/admin/leads-crud(-working)`, `/api/leads/bulk-delete`, `admin/leads` apiCrud) | 7 | **Option B (view)** |
| `crm_opportunities` | 1 delete route, but it manually cascades 9 child-table deletes first (`opportunities/[id]/route.ts`) | 1 | **Option B (view)** |
| `crm_opportunity_agreements` | 2 *independent* delete routes (`/api/opportunity-agreements`, `/api/agreements`) — not just cascaded from an opportunity delete | 2 | Option A (small) |
| `crm_discount_approvals` | Already has `isDeleted` — just needs `DELETE /api/discount-approvals/[id]` rewired to set it | 1 | none needed (already filtered where it matters) |
| `crm_clients` | Already has `is_deleted` — just needs the `admin/clients` apiCrud `DELETE` rewired | 1 | none needed |
| `crm_lead_reassignments` | Independent delete route (`lead-reassignments-working`), not just the lead cascade | 1 | Option A (small) |

**Key simplification**: once `crm_forum_leads` and `crm_opportunities` themselves stop being physically deleted, the 9 tables `opportunities/[id]/route.ts` currently hard-deletes as part of removing an opportunity (`crm_opportunity_payments`, `crm_opportunity_documents`, `crm_opportunity_activities`, `crm_opportunity_workflow_reviews`, `crm_opportunity_compliance_approvals`, `crm_discount_approvals`, `crm_opportunity_handover_notes`, `crm_opportunity_quotations`) **never get touched at all anymore** — they just stay attached to the (hidden, soft-deleted) parent opportunity. Same logic applies to the lead-children now protected by the `20260926` RESTRICT migration (`crm_pay_history`, `crm_3party_payment`, `crm_remarks`, `crm_forum_leads_remarks`, `crm_forum_leads_contracts`, the assessment tables, `crm_immigration_tool_results`) — none of them have their own independent delete route today, so **they need no soft-delete work of their own**; they're only at risk when the *lead* is hard-deleted, and once that stops, they're permanently safe.

### Tier 2 — Independently-deletable, moderate traffic

Each has its own dedicated delete route, single-digit read call sites, no cascade complexity:
- 8 HR tables (`crm_hr_attendance_records`, `crm_hr_leave_requests`, `crm_hr_eosb_settlements`, `crm_hr_exit_checklists`(+`_items`), `crm_hr_payslips`, `crm_hr_employee_letters`, `crm_hr_exit_interviews`, `crm_hr_holidays`) — all via `hr-service.ts`
- `crm_assignment_rules` + `crm_assignment_rule_state`
- `crm_saved_reports`, `crm_prospects` (+`crm_prospect_documents`, `crm_prospect_remarks`)
- `crm_countries_type_program`, `crm_lead_status`, `crm_meta_quality_mappings`, `crm_meta_lead_mappings`, `crm_auto_reassignment_rules`, `crm_calendar_events`
- `crm_crm_entries` (+4 child tables: `_requirements`, `_documents`, `_milestones`, `_notes`)
- `crm_opportunity_payment_schedules`, `crm_opportunity_accounting_verifications` (deleted via `crm-workflow-service.ts`'s re-submission flow, not the opportunity cascade)

### Tier 3 — Reference/admin/config tables

Lower risk (admin-managed lookup data, not client-facing business records), small tables, mostly the generic `apiCrud.ts` handler or a dedicated small route:
- `crm_accounts`, `appointments`, `crm_employee_attendance`, `crm_b2b`, `crm_campaigns`, `crm_employer`, `crm_b2b_invoices`, `crm_task` (generic `apiCrud.ts`, CEO-only)
- `crm_role`, `crm_region`, `crm_service`, `crm_country_proces`, `crm_department`, `crm_currency`, `crm_branch`, `crm_source` (admin reference-data pages)
- `crm_email_templates`, `crm_additional_documents`, `crm_ops_documents`, `crm_opportunity_documents`, `crm_ops_assignments`, `crm_expense`, `crm_exchange_rate`, `crm_branch_exchange_rate_map`, `crm_coa_accounts`, `crm_fee`, `crm_3party_payment`, `crm_forum_leads_fee`

### Explicitly excluded — recommend leaving these hard-delete

- **`crm_notifications`**: 2,821 rows today, personal/ephemeral per-employee inbox items, already has a scheduled 30-day cleanup job (`websocket-server.ts:349`) that hard-deletes old ones on purpose. Soft-deleting a high-volume, low-value, already-self-pruning table just grows it forever for no benefit.
- **`src/lib/database.ts`'s `DatabaseService` class** (8 delete methods: lead, employee, program, fee, currency, role, source, branch, region): confirmed dead code, zero callers anywhere in the repo. Recommend deleting this file outright in a small cleanup pass rather than converting unused code — flag for a separate decision, not part of this initiative.

## Sequencing

1. **Tier 1 easy wins first** (lowest risk, immediate value): rewire `crm_discount_approvals` and `crm_clients`'s existing `DELETE` routes to use their already-existing soft-delete column. No schema change needed.
2. **`crm_opportunity_agreements` + `crm_lead_reassignments`**: add `is_deleted`/`deleted_at`/`deleted_by`, rewire their 3 combined delete routes, patch their small read-site counts directly (Option A).
3. **`crm_opportunities`**: add the soft-delete columns, do the view-swap (rename + `CREATE VIEW`, repoint its ~6 inbound FKs), rewrite `opportunities/[id]/route.ts` to stop cascading 9 child-table deletes and just set the flag. This is the first time the view technique gets proven out — smaller blast radius than leads, good place to validate the approach before touching the biggest table.
4. **`crm_forum_leads`**: the big one. Add soft-delete columns, view-swap (rename + view, repoint ~15 inbound FKs), rewrite the 7 delete call sites. Do this only after step 3 has proven the view technique works cleanly in this codebase.
5. **Tier 2**, one table (or tight cluster, like the 8 HR tables together) per pass — mechanical repetition of the same add-column + rewrite-route pattern, low risk, can be parallelized across sessions.
6. **Tier 3**, same mechanical pattern, lowest priority — these are admin-only reference-data deletes, not client-facing business risk.
7. Decide separately on `src/lib/database.ts` (delete the dead code or convert it) and confirm the `crm_notifications` exclusion.

## Verification per table

For each converted table: confirm the delete action now sets `is_deleted=1` instead of removing the row (query the DB directly, don't just trust the UI response); confirm the record disappears from every list/search/report it used to appear in; confirm a *second* delete attempt on an already-soft-deleted row doesn't error; for Tier 1's view-swapped tables specifically, confirm `INSERT`/`UPDATE` through the view still works end-to-end (create a lead, edit a lead) and that every FK that used to point at the renamed table still enforces correctly against the new base-table name.
