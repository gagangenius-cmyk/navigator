-- Tier 1 of plans/soft-delete-conversion-plan.md: crm_opportunity_agreements
-- and crm_lead_reassignments both have their own independent DELETE routes
-- (not just cascaded from deleting a lead/opportunity), so - unlike
-- crm_discount_approvals and crm_clients, which already had a soft-delete
-- column - these two need one added.
ALTER TABLE crm_opportunity_agreements
  ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by INT NULL,
  ADD INDEX idx_opportunity_agreements_is_deleted (is_deleted);

ALTER TABLE crm_lead_reassignments
  ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by INT NULL,
  ADD INDEX idx_lead_reassignments_is_deleted (is_deleted);
