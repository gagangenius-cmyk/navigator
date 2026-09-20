-- Tier 1 continued (plans/soft-delete-conversion-plan.md): crm_opportunities
-- gets its own is_deleted/deleted_at/deleted_by, same shape as
-- crm_opportunity_agreements/crm_lead_reassignments in 20260927. Direct
-- read-site patching chosen over the plan's view-swap alternative for this
-- table (and crm_forum_leads next) - this is a live database, and renaming
-- a core table + repointing its FKs in one shot is a bigger, harder-to-
-- reverse step than patching read call sites one file at a time.
ALTER TABLE crm_opportunities
  ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0,
  ADD COLUMN deleted_at DATETIME NULL,
  ADD COLUMN deleted_by INT NULL,
  ADD INDEX idx_opportunities_is_deleted (is_deleted);
