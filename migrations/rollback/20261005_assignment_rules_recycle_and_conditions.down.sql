-- Rollback for migrations/20261005_assignment_rules_recycle_and_conditions.sql.
--
-- NOT auto-applied (scripts/setup-database.js does not read rollback/).
-- Apply manually and deliberately. Dropping these columns permanently loses
-- every rule's configured campaign/status conditions, always-available
-- overrides, and stale-recycle thresholds, and loses the record of which
-- rule assigned each lead (stale-lead recycling silently stops recycling
-- anything until re-applied). Revert the code too, or the columns are
-- re-created lazily on the next request.
ALTER TABLE crm_forum_leads DROP COLUMN assigned_by_rule_id;
ALTER TABLE crm_assignment_rules DROP COLUMN stale_recycle_hours;
ALTER TABLE crm_assignment_rules DROP COLUMN always_available_employee_ids;
ALTER TABLE crm_assignment_rules DROP COLUMN statuses;
ALTER TABLE crm_assignment_rules DROP COLUMN campaigns;
