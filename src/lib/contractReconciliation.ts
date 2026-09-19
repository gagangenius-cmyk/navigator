import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { logAudit } from './auditLog';
import { notifyRole } from './notify';

// No mutation path in this codebase locks the contract row anywhere except
// the two writers that update crm_contracts.paid_yet/pay_balance themselves
// (src/app/api/admin/contracts/route.ts, src/app/api/contracts/[id]/receipts/route.ts)
// - both of those DO lock (SELECT ... FOR UPDATE) before recomputing, but a
// bug in either one, a manual DB edit, or a future write path that forgets
// to lock could still let the cached rollup drift from its source
// (crm_contract_receipts). This sweep is the safety net the enterprise
// review flagged as missing: it never corrects anything itself (a silent
// auto-fix could paper over a real bug) - it only flags drift for finance
// to investigate.
const DRIFT_TOLERANCE = 0.01;

export interface ContractDrift {
  contractId: number;
  contractNumber: string;
  leadId: number;
  branchId: number;
  storedPaidYet: number;
  computedPaidYet: number;
  storedPayBalance: number;
  computedPayBalance: number;
}

export async function findContractDrift(): Promise<ContractDrift[]> {
  const rows = await sequelize.query<{
    id: number; contract_number: string; lead_id: number; branch_id: number;
    pay_total: number; discount: number; paid_yet: number; pay_balance: number;
    receipts_sum: number;
  }>(
    `SELECT c.id, c.contract_number, c.lead_id, c.branch_id,
            c.pay_total, c.discount, c.paid_yet, c.pay_balance,
            COALESCE(SUM(r.paid_amount), 0) AS receipts_sum
     FROM crm_contracts c
     LEFT JOIN crm_contract_receipts r ON r.contract_id = c.id
     WHERE c.is_deleted = 0
     GROUP BY c.id, c.contract_number, c.lead_id, c.branch_id, c.pay_total, c.discount, c.paid_yet, c.pay_balance
     HAVING ABS(c.paid_yet - COALESCE(SUM(r.paid_amount), 0)) > :tolerance
        OR ABS(c.pay_balance - (c.pay_total - c.discount - c.paid_yet)) > :tolerance`,
    { replacements: { tolerance: DRIFT_TOLERANCE }, type: QueryTypes.SELECT }
  );

  return rows.map((row) => ({
    contractId: row.id,
    contractNumber: row.contract_number,
    leadId: row.lead_id,
    branchId: row.branch_id,
    storedPaidYet: Number(row.paid_yet),
    computedPaidYet: Number(row.receipts_sum),
    storedPayBalance: Number(row.pay_balance),
    computedPayBalance: Number(row.pay_total) - Number(row.discount) - Number(row.receipts_sum),
  }));
}

export async function runContractReconciliation(): Promise<{ checked: number; drifted: number }> {
  const [{ checked }] = await sequelize.query<{ checked: number }>(
    `SELECT COUNT(*) AS checked FROM crm_contracts WHERE is_deleted = 0`,
    { type: QueryTypes.SELECT }
  );
  const drift = await findContractDrift();

  for (const d of drift) {
    await logAudit({
      entityType: 'contract',
      entityId: d.contractId,
      action: 'contract_reconciliation_drift',
      summary: `Contract ${d.contractNumber}: stored paidYet ${d.storedPaidYet} vs receipts sum ${d.computedPaidYet}; stored payBalance ${d.storedPayBalance} vs computed ${d.computedPayBalance}`,
      before: { paidYet: d.storedPaidYet, payBalance: d.storedPayBalance },
      after: { paidYet: d.computedPaidYet, payBalance: d.computedPayBalance },
    });

    await notifyRole({
      roleType: 'accountant',
      branchId: d.branchId,
      type: 'contract_reconciliation_drift',
      title: 'Contract balance drift detected',
      message: `Contract ${d.contractNumber}'s stored paid/balance amounts don't match its receipt history — needs a finance review.`,
      priority: 'high',
      relatedId: d.contractId,
      relatedType: 'contract',
    });
  }

  return { checked: Number(checked), drifted: drift.length };
}
