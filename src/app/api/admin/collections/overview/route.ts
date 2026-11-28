import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { canViewAllBranches, isBranchManagerOrCeo, isCeo, isFinanceOrAccounts, isFoe } from '@/lib/roleChecks';
import { resolveBranchCurrency } from '@/lib/branchCurrency';
import { dubaiToday } from '@/lib/dubaiDate';
import { addMonths, toCents } from '@/lib/installments';
import { ensureInstallmentColumns, loadPlans } from '@/lib/installmentsServer';

// Dashboard money figures: Payment Received, Payment Collection (due this month)
// and Payment Projection. Definitions: plans/installment-plan-and-collections.md.

const VIEW_PERMISSIONS = ['all', 'sales.view', 'sales.create', 'payments.view', 'finance.view', 'finance.manage'];
const PROJECTION_MONTHS = 6;

interface Totals {
  currency: string;
  receivedToday: number;
  receivedMonth: number;
  receivedMonthVerified: number;
  receivedMonthPending: number;
  receivedLastMonth: number;
  dueMonth: number;
  collectedOfDue: number;
  outstandingMonth: number;
  overdue: number;
  noDate: number;
  projection: Record<string, number>;
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth) && !VIEW_PERMISSIONS.some((p) => auth.permissions?.includes(p))) {
    return NextResponse.json({ error: 'You do not have permission to view collections' }, { status: 403 });
  }

  try {
    await ensureInstallmentColumns();
    const scope = isCeo(auth) || canViewAllBranches(auth) || isFinanceOrAccounts(auth)
      ? 'all'
      : isBranchManagerOrCeo(auth) || isFoe(auth) ? 'branch' : 'own';
    const scopeSql = scope === 'branch'
      ? 'AND COALESCE(ct.branch_id, l.branch, o.branchId) = :branch'
      : scope === 'own'
        ? 'AND (l.Counsilor = :userId OR l.assignTo = :userId OR o.assignedTo = :userId OR o.createdBy = :userId)'
        : '';

    const today = dubaiToday();
    const month = today.slice(0, 7);
    const monthStart = `${month}-01`;
    const lastMonthStart = addMonths(monthStart, -1);
    const projectionMonths = Array.from({ length: PROJECTION_MONTHS }, (_, i) => addMonths(monthStart, i).slice(0, 7));
    const replacements = { branch: auth.branch || 0, userId: auth.id, lastMonthStart };

    const joins = `
      JOIN crm_opportunities o ON o.id = {opp} AND o.is_deleted = 0
      LEFT JOIN crm_forum_leads l ON l.id = o.leadId
      LEFT JOIN crm_contracts ct ON ct.opportunity_id = o.id AND ct.is_deleted = 0`;

    const [receipts, balances] = await Promise.all([
      // Contract-route receipts that have no matching opportunity payment are added
      // by the second SELECT so nothing is missed or counted twice.
      sequelize.query<{ amount: string; currency: string | null; day: string; verified: number }>(
        `SELECT p.paidAmount AS amount, p.currency,
                DATE_FORMAT(p.paymentDate + INTERVAL 4 HOUR, '%Y-%m-%d') AS day,
                (p.accountantStatus <=> 'verified') AS verified
         FROM crm_opportunity_payments p
         ${joins.replace('{opp}', 'p.opportunityId')}
         WHERE COALESCE(p.accountantStatus, 'pending') <> 'rejected'
           AND DATE(p.paymentDate + INTERVAL 4 HOUR) >= :lastMonthStart ${scopeSql}
         UNION ALL
         SELECT r.paid_amount, r.currency,
                DATE_FORMAT(r.payment_date + INTERVAL 4 HOUR, '%Y-%m-%d'),
                (r.accountant_status <=> 'verified')
         FROM crm_contract_receipts r
         JOIN crm_contracts rc ON rc.id = r.contract_id AND rc.is_deleted = 0
         ${joins.replace('{opp}', 'rc.opportunity_id')}
         WHERE r.status NOT IN ('failed', 'refunded') AND COALESCE(r.accountant_status, 'pending') <> 'rejected'
           AND DATE(r.payment_date + INTERVAL 4 HOUR) >= :lastMonthStart ${scopeSql}
           AND NOT EXISTS (SELECT 1 FROM crm_opportunity_payments x
                           WHERE x.opportunityId = rc.opportunity_id
                             AND (x.receiptNumber = r.receipt_number OR x.paymentNumber = r.receipt_number))`,
        { replacements, type: QueryTypes.SELECT },
      ),
      sequelize.query<{
        opportunityId: number; leadId: number; client: string; counselor: string | null; branchId: number | null;
        balance: string | null; dueDate: string | null;
      }>(
        `SELECT o.id AS opportunityId, l.id AS leadId,
                TRIM(CONCAT_WS(' ', l.fname, l.lname)) AS client,
                e.name AS counselor,
                COALESCE(ct.branch_id, l.branch, o.branchId) AS branchId,
                COALESCE(ct.pay_balance, l.payBalance) AS balance,
                DATE_FORMAT(COALESCE(ct.due_date, l.dueDate), '%Y-%m-%d') AS dueDate
         FROM crm_opportunities o
         JOIN crm_forum_leads l ON l.id = o.leadId
         LEFT JOIN crm_contracts ct ON ct.opportunity_id = o.id AND ct.is_deleted = 0
         LEFT JOIN crm_employee e ON e.id = o.assignedTo
         WHERE o.is_deleted = 0
           AND (COALESCE(ct.pay_balance, l.payBalance) > 0
                OR EXISTS (SELECT 1 FROM crm_opportunity_payment_schedules s WHERE s.opportunity_id = o.id))
           ${scopeSql}`,
        { replacements, type: QueryTypes.SELECT },
      ),
    ]);

    const plans = await loadPlans(balances.map((b) => Number(b.opportunityId)));

    const currencyByBranch = new Map<number, string>();
    await Promise.all(Array.from(new Set(balances.map((b) => Number(b.branchId || 0)))).map(async (id) => {
      currencyByBranch.set(id, (await resolveBranchCurrency(id || null))?.currencyCode || 'AED');
    }));

    // Sums are kept in cents and converted once at the end.
    const byCurrency = new Map<string, Totals>();
    const totalsFor = (currency: string) => {
      if (!byCurrency.has(currency)) {
        byCurrency.set(currency, {
          currency, receivedToday: 0, receivedMonth: 0, receivedMonthVerified: 0, receivedMonthPending: 0,
          receivedLastMonth: 0, dueMonth: 0, collectedOfDue: 0, outstandingMonth: 0, overdue: 0, noDate: 0,
          projection: Object.fromEntries(projectionMonths.map((m) => [m, 0])),
        });
      }
      return byCurrency.get(currency)!;
    };

    for (const r of receipts) {
      const totals = totalsFor(r.currency || 'AED');
      const cents = toCents(r.amount);
      if (r.day.startsWith(month)) {
        totals.receivedMonth += cents;
        if (Number(r.verified)) totals.receivedMonthVerified += cents;
        else totals.receivedMonthPending += cents;
        if (r.day === today) totals.receivedToday += cents;
      } else if (r.day >= lastMonthStart && r.day < monthStart) {
        totals.receivedLastMonth += cents;
      }
    }

    const dueList: Array<{
      opportunityId: number; leadId: number; client: string; counselor: string | null; currency: string;
      dueDate: string; remaining: number; installment: string; overdue: boolean;
    }> = [];

    for (const b of balances) {
      const currency = currencyByBranch.get(Number(b.branchId || 0)) || 'AED';
      const totals = totalsFor(currency);
      const plan = plans.get(Number(b.opportunityId));
      // A balance without a saved plan counts as one instalment on its due date.
      const items = plan
        ? [
            ...plan.installments.map((i) => ({ dueDate: i.dueDate, amount: i.amount, paid: i.paid, remaining: i.remaining, label: `${i.number} of ${plan.installments.length}` })),
            ...(plan.unscheduled > 0 ? [{ dueDate: null, amount: plan.unscheduled, paid: 0, remaining: plan.unscheduled, label: 'Unscheduled' }] : []),
          ]
        : [{ dueDate: b.dueDate, amount: Number(b.balance || 0), paid: 0, remaining: Number(b.balance || 0), label: 'Balance' }];

      for (const item of items) {
        const remaining = toCents(item.remaining);
        if (!item.dueDate) {
          totals.noDate += remaining;
          continue;
        }
        const itemMonth = item.dueDate.slice(0, 7);
        if (itemMonth === month) {
          totals.dueMonth += toCents(item.paid) + remaining;
          totals.collectedOfDue += toCents(item.paid);
          totals.outstandingMonth += remaining;
        }
        const overdue = item.dueDate < today;
        if (overdue) totals.overdue += remaining;
        // Overdue money is reported on its own, not projected again.
        else if (itemMonth in totals.projection) totals.projection[itemMonth] += remaining;

        if (remaining > 0 && (overdue || itemMonth === month)) {
          dueList.push({
            opportunityId: Number(b.opportunityId), leadId: Number(b.leadId), client: b.client, counselor: b.counselor,
            currency, dueDate: item.dueDate, remaining: remaining / 100, installment: item.label, overdue,
          });
        }
      }
    }

    const totals = Array.from(byCurrency.values())
      .map((t) => ({
        ...t,
        ...Object.fromEntries(
          (['receivedToday', 'receivedMonth', 'receivedMonthVerified', 'receivedMonthPending', 'receivedLastMonth',
            'dueMonth', 'collectedOfDue', 'outstandingMonth', 'overdue', 'noDate'] as const).map((k) => [k, t[k] / 100]),
        ),
        projection: projectionMonths.map((m) => ({ month: m, amount: t.projection[m] / 100 })),
      }))
      .sort((a, b) => (a.currency === 'AED' ? -1 : b.currency === 'AED' ? 1 : a.currency.localeCompare(b.currency)));

    dueList.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return NextResponse.json({
      scope,
      month,
      canViewPnl: isCeo(auth),
      totals,
      dueList: dueList.slice(0, 50),
      dueCount: dueList.length,
    });
  } catch (error) {
    console.error('Error building collections overview:', error);
    return NextResponse.json({ error: 'Failed to load collection figures' }, { status: 500 });
  }
}
