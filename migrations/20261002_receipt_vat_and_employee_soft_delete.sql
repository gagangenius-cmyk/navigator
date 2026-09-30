-- 1) crm_pay_history.vat_included: the counselor's "Include VAT" choice at
--    receipt generation. 1 (default) keeps the branch-driven VAT/GST treatment,
--    so every receipt issued before this column existed reprints unchanged;
--    0 prints a plain Payment Receipt with no VAT/GST wording.
-- 2) crm_employee.is_deleted: CEO "delete" on the HR Employee Data Sheet.
--    A soft delete - the row and its payroll/attendance history are kept, but
--    the employee is hidden from HR lists and dashboard counts. Distinct from
--    status = 0, which is a plain deactivation that still shows as Inactive.
--
-- Also self-provisioned lazily (src/lib/ensurePayHistoryAdminFeeColumns.ts and
-- HRService.ensureWorkforceDashboardTablesUncached); this file is for
-- fresh-install parity. Duplicate-column errors are tolerated by
-- scripts/setup-database.js, so it is safe if the lazy ensure ran first.
-- Rollback: migrations/rollback/20261002_receipt_vat_and_employee_soft_delete.down.sql
ALTER TABLE crm_pay_history ADD COLUMN vat_included TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE crm_employee ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0;
