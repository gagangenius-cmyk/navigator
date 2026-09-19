import { NextRequest, NextResponse } from 'next/server';
import { sequelize, connectDB } from '@/lib/sequelize';
import { QueryTypes } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isBranchManagerOrCeo, isCeo } from '@/lib/roleChecks';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['clients.view']);
  if (isAuthError(auth)) return auth;

  await ensureDB();

  try {
  // Keyed the same way as GET /api/admin/clients: a "client" is a lead whose
  // workflow review has both finance and compliance verification approved
  // (crm_opportunity_workflow_reviews), not the unpopulated crm_clients table.
  // One row per approved opportunity/contract, not per lead - opportunity_id
  // is already UNIQUE on crm_opportunity_workflow_reviews, so (unlike the
  // MAX(id)/GROUP BY collapse this used to do) no row needs to be discarded.
  // Balances come from the contract when one exists (COALESCE falls back to
  // the lead's legacy flat fields for a won opportunity that predates the
  // contract model), and the crm_pay_history join is scoped to that specific
  // contract so a lead with several contracts doesn't have every contract's
  // receipt count/date double-counted against every other one.
  // Branch Manager gets the same own-branch-only scoping as the clients list
  // itself - CEO and every other clients.view holder see everything.
  const branchScoped = isBranchManagerOrCeo(auth) && !isCeo(auth);
  const rows = await sequelize.query<{
    clientId: number;
    leadId: number;
    contractId: number | null;
    contractNumber: string | null;
    payTotal: number;
    paidYet: number;
    payBalance: number;
    receiptCount: number;
    lastReceiptNumber: string;
    lastPaymentDate: string;
  }>(
    `SELECT
       w.id                              AS clientId,
       w.lead_id                         AS leadId,
       ct.id                             AS contractId,
       ct.contract_number                AS contractNumber,
       COALESCE(ct.pay_total, l.payTotal)     AS payTotal,
       COALESCE(ct.paid_yet, l.paidYet)        AS paidYet,
       COALESCE(ct.pay_balance, l.payBalance)  AS payBalance,
       COUNT(ph.id)              AS receiptCount,
       MAX(ph.counselor_receipt) AS lastReceiptNumber,
       MAX(ph.date)              AS lastPaymentDate
     FROM crm_opportunity_workflow_reviews w
     JOIN crm_forum_leads l ON l.id = w.lead_id
     LEFT JOIN crm_contracts ct ON ct.opportunity_id = w.opportunity_id AND ct.is_deleted = 0
     LEFT JOIN crm_pay_history ph ON
       (ct.id IS NOT NULL AND ph.contract_id = ct.id)
       OR (ct.id IS NULL AND ph.leadId = w.lead_id AND ph.contract_id IS NULL)
     WHERE w.finance_status = 'approved' AND w.compliance_status = 'approved'
       ${branchScoped ? 'AND COALESCE(ct.branch_id, l.branch) = :userBranch' : ''}
     GROUP BY w.id, w.lead_id, ct.id, ct.contract_number, l.payTotal, l.paidYet, l.payBalance, ct.pay_total, ct.paid_yet, ct.pay_balance`,
    { replacements: branchScoped ? { userBranch: auth.branch || 0 } : {}, type: QueryTypes.SELECT }
  );
  return NextResponse.json({ data: rows });
  } catch (err: any) {
    console.error('[clients/balances] error:', err.message);
    return NextResponse.json({ error: err.message, data: [] }, { status: 500 });
  }
}
