import { QueryTypes, type Transaction } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { formatReceiptNumber } from '@/lib/documentNumbering';

type ReceiptNumberParams = Omit<Parameters<typeof formatReceiptNumber>[0], 'sequenceId'>;

/**
 * Allocates a receipt number (RCP-{branch}-{YYYYMM}-{seq}) that no other receipt already uses.
 *
 * Receipts live in two tables - crm_opportunity_payments and crm_contract_receipts - and each used to
 * take the {seq} from its OWN auto-increment id, so the same number was handed out twice (found on
 * crm_next: RCP-DXB-202611-005 on a payment and on a contract receipt). The candidate sequence is
 * checked against both tables and bumped until it is free.
 */
export async function uniqueReceiptNumber(
  params: ReceiptNumberParams,
  startSequence: number,
  transaction?: Transaction | null,
): Promise<string> {
  let sequence = Math.max(1, Math.floor(startSequence) || 1);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = formatReceiptNumber({ ...params, sequenceId: sequence });
    const taken = await sequelize.query<{ x: number }>(
      `SELECT 1 AS x FROM crm_opportunity_payments WHERE receiptNumber = :n OR paymentNumber = :n
       UNION ALL
       SELECT 1 AS x FROM crm_contract_receipts WHERE receipt_number = :n
       LIMIT 1`,
      { replacements: { n: candidate }, type: QueryTypes.SELECT, transaction: transaction ?? undefined },
    );
    if (!taken.length) return candidate;
    sequence += 1;
  }
  throw new Error('Could not allocate a unique receipt number');
}
