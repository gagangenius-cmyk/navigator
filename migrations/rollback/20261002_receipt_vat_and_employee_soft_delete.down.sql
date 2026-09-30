-- Rollback for migrations/20261002_receipt_vat_and_employee_soft_delete.sql.
--
-- NOT auto-applied (scripts/setup-database.js does not read rollback/).
-- Apply manually and deliberately. Dropping is_deleted makes every
-- soft-deleted employee reappear in HR lists (as Inactive); dropping
-- vat_included loses each receipt's saved VAT choice, so reprints go back to
-- branch-driven VAT. Revert the code too, or the columns are re-added lazily.
ALTER TABLE crm_employee DROP COLUMN is_deleted;
ALTER TABLE crm_pay_history DROP COLUMN vat_included;
