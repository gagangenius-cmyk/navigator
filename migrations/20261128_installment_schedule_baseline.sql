-- Total already paid when an instalment plan was saved. Paid status of each
-- instalment is derived from (paid now - baseline_paid), see src/lib/installments.ts.
-- Also applied automatically by ensureInstallmentColumns() on first use.
ALTER TABLE crm_opportunity_payment_schedules
  ADD COLUMN baseline_paid DECIMAL(15,2) NULL AFTER amount;
