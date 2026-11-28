import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { assertOpportunityAccess } from '@/lib/leadAccess';
import { isBranchManagerOrCeo } from '@/lib/roleChecks';
import { resolveBranchCurrency } from '@/lib/branchCurrency';
import { logAudit } from '@/lib/auditLog';
import { toCents, validatePlan, type Installment } from '@/lib/installments';
import { ensureInstallmentColumns, loadPlan, replacePlan, syncNextDueDate } from '@/lib/installmentsServer';
import type { User } from '@/lib/auth';

const WRITE_PERMISSIONS = ['all', 'payments.view', 'payments.create', 'finance.view', 'finance.manage', 'sales.create'];
const canWrite = (user: User) => isBranchManagerOrCeo(user) || WRITE_PERMISSIONS.some((p) => user.permissions?.includes(p));

async function readContext(opportunityId: number) {
  const [row] = await sequelize.query<{ leadId: number | null; branchId: number | null; balance: string | null; paid: string | null }>(
    `SELECT o.leadId, COALESCE(ct.branch_id, l.branch, o.branchId) AS branchId,
            COALESCE(ct.pay_balance, l.payBalance) AS balance,
            COALESCE(ct.paid_yet, l.paidYet) AS paid
     FROM crm_opportunities o
     LEFT JOIN crm_forum_leads l ON l.id = o.leadId
     LEFT JOIN crm_contracts ct ON ct.opportunity_id = o.id AND ct.is_deleted = 0
     WHERE o.id = :opportunityId AND o.is_deleted = 0 LIMIT 1`,
    { replacements: { opportunityId }, type: QueryTypes.SELECT },
  );
  return row || null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  const opportunityId = Number((await params).id);
  try {
    const denied = await assertOpportunityAccess(auth, opportunityId);
    if (denied) return denied;
    const context = await readContext(opportunityId);
    if (!context) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
    const [plan, currency] = await Promise.all([loadPlan(opportunityId), resolveBranchCurrency(context.branchId)]);
    return NextResponse.json({
      balance: Number(context.balance || 0),
      currencyCode: currency?.currencyCode || 'AED',
      canEdit: canWrite(auth),
      ...plan,
    });
  } catch (error) {
    console.error('Error loading instalment plan:', error);
    return NextResponse.json({ error: 'Failed to load the instalment plan' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  const opportunityId = Number((await params).id);
  try {
    const denied = await assertOpportunityAccess(auth, opportunityId);
    if (denied) return denied;
    if (!canWrite(auth)) return NextResponse.json({ error: 'You do not have permission to change payment plans' }, { status: 403 });

    const body = await request.json().catch(() => null);
    await ensureInstallmentColumns();
    const context = await readContext(opportunityId);
    if (!context) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });

    const outcome = await sequelize.transaction(async (transaction) => {
      // Same lock /api/receipts takes, so a payment can't change the balance mid-save.
      if (context.leadId) {
        await sequelize.query('SELECT id FROM crm_forum_leads WHERE id = :leadId FOR UPDATE', {
          replacements: { leadId: context.leadId }, transaction,
        });
      }
      const [money] = await sequelize.query<{ balance: string | null; paid: string | null }>(
        `SELECT COALESCE(ct.pay_balance, l.payBalance) AS balance, COALESCE(ct.paid_yet, l.paidYet) AS paid
         FROM crm_opportunities o
         LEFT JOIN crm_forum_leads l ON l.id = o.leadId
         LEFT JOIN crm_contracts ct ON ct.opportunity_id = o.id AND ct.is_deleted = 0
         WHERE o.id = :opportunityId LIMIT 1 FOR UPDATE`,
        { replacements: { opportunityId }, type: QueryTypes.SELECT, transaction },
      );
      const balance = Number(money?.balance || 0);
      if (toCents(balance) <= 0) return { error: 'There is no outstanding balance to schedule.' };
      const invalid = validatePlan(body?.installments, balance);
      if (invalid) return { error: invalid };

      const rows = (body.installments as Installment[]).map((r) => ({ dueDate: r.dueDate, amount: Number(r.amount) }));
      const previous = await loadPlan(opportunityId, transaction);
      await replacePlan({ opportunityId, rows, baselinePaid: Number(money?.paid || 0), userId: auth.id }, transaction);
      return { rows, previous: previous.installments };
    });

    if ('error' in outcome) return NextResponse.json({ error: outcome.error }, { status: 422 });

    await syncNextDueDate(opportunityId).catch((error) => console.error('Could not sync next due date:', error));
    await logAudit({
      entityType: 'payment_schedule',
      entityId: opportunityId,
      action: outcome.previous.length ? 'schedule_changed' : 'schedule_created',
      summary: `Instalment plan (${outcome.rows.length}) saved for opportunity #${opportunityId}`,
      actorId: auth.id,
      actorRole: auth.roleName || auth.type || null,
      before: { installments: outcome.previous.map((r) => ({ dueDate: r.dueDate, amount: r.amount, paid: r.paid })) },
      after: { installments: outcome.rows },
    });

    return NextResponse.json({ success: true, ...(await loadPlan(opportunityId)) });
  } catch (error) {
    console.error('Error saving instalment plan:', error);
    return NextResponse.json({ error: 'Failed to save the instalment plan' }, { status: 500 });
  }
}
