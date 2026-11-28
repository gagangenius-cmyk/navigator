import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { allocatePlan, type AllocatedInstallment, type Installment } from '@/lib/installments';
import { dubaiToday } from '@/lib/dubaiDate';

// baseline_paid is added lazily, like the other columns in this project
// (see ensurePayHistoryAdminFeeColumns.ts). Call before opening a transaction:
// DDL commits implicitly.
let columnsReady: Promise<void> | null = null;
export const ensureInstallmentColumns = async () => {
  if (!columnsReady) {
    columnsReady = (async () => {
      const rows = await sequelize.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_opportunity_payment_schedules' AND COLUMN_NAME = 'baseline_paid'`,
        { type: QueryTypes.SELECT },
      );
      if (!rows.length) {
        await sequelize.query('ALTER TABLE crm_opportunity_payment_schedules ADD COLUMN baseline_paid DECIMAL(15,2) NULL AFTER amount');
      }
    })().catch((error) => {
      columnsReady = null;
      throw error;
    });
  }
  await columnsReady;
};

export interface OpportunityPlan {
  installments: AllocatedInstallment[];
  unscheduled: number;
}

/**
 * Saved plans for many opportunities, with paid status worked out from the same
 * paid/outstanding figures Balance Payments shows. Opportunities without a plan
 * are absent from the map.
 */
export async function loadPlans(opportunityIds: number[], transaction?: Transaction): Promise<Map<number, OpportunityPlan>> {
  const result = new Map<number, OpportunityPlan>();
  if (!opportunityIds.length) return result;
  await ensureInstallmentColumns();

  const rows = await sequelize.query<{
    opportunityId: number; dueDate: string; amount: string; baselinePaid: string | null; paidNow: string | null; balance: string | null;
  }>(
    `SELECT s.opportunity_id AS opportunityId,
            DATE_FORMAT(s.due_date, '%Y-%m-%d') AS dueDate,
            s.amount, s.baseline_paid AS baselinePaid,
            COALESCE(ct.paid_yet, l.paidYet) AS paidNow,
            COALESCE(ct.pay_balance, l.payBalance) AS balance
     FROM crm_opportunity_payment_schedules s
     JOIN crm_opportunities o ON o.id = s.opportunity_id
     LEFT JOIN crm_forum_leads l ON l.id = o.leadId
     LEFT JOIN crm_contracts ct ON ct.opportunity_id = o.id AND ct.is_deleted = 0
     WHERE s.opportunity_id IN (:opportunityIds) AND s.status <> 'cancelled'
     ORDER BY s.opportunity_id, s.installment_number`,
    { replacements: { opportunityIds }, type: QueryTypes.SELECT, transaction },
  );

  const grouped = new Map<number, typeof rows>();
  for (const row of rows) {
    const id = Number(row.opportunityId);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id)!.push(row);
  }

  const today = dubaiToday();
  for (const [id, group] of grouped) {
    const { paidNow, balance, baselinePaid } = group[0];
    // Rows written without a baseline (older workflow route) count nothing as paid yet.
    const paidSince = baselinePaid === null ? 0 : Number(paidNow || 0) - Number(baselinePaid);
    result.set(id, allocatePlan(
      group.map((r) => ({ dueDate: r.dueDate, amount: Number(r.amount) })),
      paidSince,
      Number(balance || 0),
      today,
    ));
  }
  return result;
}

export async function loadPlan(opportunityId: number, transaction?: Transaction): Promise<OpportunityPlan> {
  return (await loadPlans([opportunityId], transaction)).get(opportunityId) || { installments: [], unscheduled: 0 };
}

/** Replaces the opportunity's plan. The caller validates the rows and owns the transaction. */
export async function replacePlan(
  options: { opportunityId: number; rows: Installment[]; baselinePaid: number; userId: number | null },
  transaction: Transaction,
) {
  const { opportunityId, rows, baselinePaid, userId } = options;
  await sequelize.query('DELETE FROM crm_opportunity_payment_schedules WHERE opportunity_id = :opportunityId', {
    replacements: { opportunityId }, transaction,
  });
  for (let i = 0; i < rows.length; i += 1) {
    await sequelize.query(
      `INSERT INTO crm_opportunity_payment_schedules
         (opportunity_id, installment_number, due_date, amount, baseline_paid, status, created_by)
       VALUES (:opportunityId, :number, :dueDate, :amount, :baselinePaid, 'pending', :userId)`,
      {
        replacements: { opportunityId, number: i + 1, dueDate: rows[i].dueDate, amount: Number(rows[i].amount), baselinePaid, userId },
        transaction,
      },
    );
  }
}

/**
 * Keeps the legacy "balance due date" columns (read by recovery and finance
 * reports) pointing at the next unpaid instalment.
 */
export async function syncNextDueDate(opportunityId: number) {
  const next = (await loadPlan(opportunityId)).installments.find((r) => r.remaining > 0)?.dueDate;
  if (!next) return;
  await sequelize.query('UPDATE crm_contracts SET due_date = :next WHERE opportunity_id = :opportunityId AND is_deleted = 0', {
    replacements: { next, opportunityId },
  });
  await sequelize.query(
    `UPDATE crm_forum_leads l JOIN crm_opportunities o ON o.leadId = l.id
     SET l.dueDate = :next WHERE o.id = :opportunityId`,
    { replacements: { next, opportunityId } },
  );
}
