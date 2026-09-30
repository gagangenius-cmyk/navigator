-- Premium package fee for crm_fee, collected as two equal (50/50) installments:
-- premium_fee_1 (first 50%) and premium_fee_2 (second 50%). The Opportunity
-- Flow offers it as a 4th package (Upfront / Stage-wise / Monthly / Premium)
-- priced at premium_fee_1 + premium_fee_2.
--
-- Also self-provisioned lazily by src/lib/ensureFeePremiumColumns.ts (the
-- CrmFee model selects these columns on every query); this file is for
-- fresh-install parity. Duplicate-column errors are tolerated by
-- scripts/setup-database.js, so it is safe if the lazy ensure ran first.
-- Rollback: migrations/rollback/20261002_fee_premium_fees.down.sql
ALTER TABLE crm_fee ADD COLUMN premium_fee_1 DECIMAL(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE crm_fee ADD COLUMN premium_fee_2 DECIMAL(10,2) NOT NULL DEFAULT 0.00;
