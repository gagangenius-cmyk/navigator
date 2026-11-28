# Instalment plans, collections dashboard, CEO-only P&L

## Goals
1. When Payment Type is **Installment**, split the balance equally; counselor can add/remove rows and change dates and amounts.
2. The plan shows on the receipt, the agreement, Balance Payments and the dashboard.
3. Main dashboard shows Payment Received, Payment Collection and Payment Projection.
4. P&L is visible to the CEO only.

## Design decisions
- **One source of truth:** `crm_opportunity_payment_schedules` (already exists, empty). One added column, `baseline_paid`.
- **Paid status is derived, never stored.** `paid since plan = paid_yet now - baseline_paid`, allocated oldest instalment first.
  Balance payments, contract receipts and Accounts rejections are therefore reflected with no sync hooks.
- **A saved plan always covers exactly the current outstanding balance** (server-checked, row-locked).
  Rescheduling replaces the plan; the previous one is kept in `crm_audit_log`.
- **Drift is shown, not hidden:** balance above the plan (e.g. rejected payment) = "unscheduled"; below it (discount) = trimmed from the last instalments.
- **Money in integer cents;** currencies are never added together.
- **Balances without a plan** but with a due date count as one instalment, so the dashboard covers existing clients.
- **Authorisation:** record-level (`assertOpportunityAccess`); counselors see and edit their own, branch roles their branch, CEO/DoS/Finance everything.
  The plan stays editable after the receipt is locked (it changes future dates, not money received).
- **Dates** are UAE calendar days (`src/lib/dubaiDate.ts`).

## Components
| Layer | File |
|---|---|
| Pure rules (split, validate, allocate) + unit tests | `src/lib/installments.ts` |
| DB access | `src/lib/installmentsServer.ts` |
| API: read/save plan | `src/app/api/opportunities/[id]/payment-schedule` |
| API: dashboard figures | `src/app/api/admin/collections/overview` |
| UI: editor, saved-plan panel | `src/components/Payments/` |
| UI: dashboard section | `src/components/dashboard/CollectionsOverview.tsx` |
| Surfaces | wizard, Balance Payments, receipt template, agreement renderer |

## Dashboard definitions
- **Received:** non-rejected payments by payment date (today / this month / last month; verified vs awaiting Accounts).
- **Collection:** instalments due this month: due, collected, outstanding, rate; overdue shown separately.
- **Projection:** unpaid amounts by due month, next 6 months.
- **P&L (CEO only):** existing P&L calculation for the current month.

## Added during delivery
- **Follow-ups:** Complete opens the same popup as Reschedule (required lead remark, lead status, Mark as complete).
  Reschedule no longer has a separate note; the lead remark becomes the new follow-up's remark.
- **Opportunity Flow speed:** each stage is a lazily loaded module in `src/app/admin/leads/opportunity-flow/_stages/`;
  the agreement templates load only when needed; the next stage is pre-fetched.

## Discount subtracted twice (fixed)
Contract balances were recalculated as `pay_total - discount - paid_yet` although lead conversion stores the total already net of discount.
The stored balance is now adjusted by what changed (payment, rejection, discount difference); see `src/lib/contractBalance.ts`.

## Known issues (not changed)
- The older dashboard "Outstanding Balance (Recovery)" tile counts contracts of deleted opportunities.
- Approving a discount writes the pre-tax discounted amount to the lead total.

## Out of scope
Mobile app, automatic client reminders, late fees, Work Permit agreement template (it has its own fee stages).

## Rollout
Additive only. The column is added automatically on first use (SQL in `migrations/`). Rollback: revert the code; the column can stay.
