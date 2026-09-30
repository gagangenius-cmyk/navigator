import { sequelize } from '@/lib/sequelize';

// crm_fee.premium_fee_1/premium_fee_2 — the premium package fee, collected as
// two 50/50 installments. Lazily added (same pattern as
// ensurePayHistoryAdminFeeColumns.ts; migrations/20261002_fee_premium_fees.sql
// is the equivalent one-off script) because the CrmFee model selects these
// columns on every query, so the fees API must never run before they exist.
let feePremiumColumnsReady: Promise<void> | null = null;
export const ensureFeePremiumColumns = async () => {
  if (!feePremiumColumnsReady) {
    feePremiumColumnsReady = (async () => {
      const [rows] = await sequelize.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_fee'
          AND COLUMN_NAME IN ('premium_fee_1', 'premium_fee_2')
      `);
      const existing = new Set(((rows as Array<{ COLUMN_NAME: string }>) || []).map((r) => r.COLUMN_NAME));
      for (const column of ['premium_fee_1', 'premium_fee_2']) {
        if (!existing.has(column)) {
          await sequelize.query(`ALTER TABLE crm_fee ADD COLUMN ${column} DECIMAL(10,2) NOT NULL DEFAULT 0.00`);
        }
      }
    })().catch((error) => {
      feePremiumColumnsReady = null;
      throw error;
    });
  }
  await feePremiumColumnsReady;
};
