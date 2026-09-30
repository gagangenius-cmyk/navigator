-- Rollback for migrations/20261002_fee_premium_fees.sql.
--
-- NOT auto-applied (scripts/setup-database.js does not read rollback/).
-- Apply manually and deliberately. This permanently deletes every stored
-- premium fee amount, and the Fees page / Opportunity Flow premium package
-- will error until the code is reverted too.
ALTER TABLE crm_fee DROP COLUMN premium_fee_2;
ALTER TABLE crm_fee DROP COLUMN premium_fee_1;
