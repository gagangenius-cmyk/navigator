-- Rollback for migrations/20261005_assignment_rules_enterprise.sql.
--
-- NOT auto-applied (scripts/setup-database.js does not read rollback/).
-- Apply manually and deliberately. Dropping these columns permanently loses
-- every rule's configured weights and capacity caps, and dropping the
-- settings table loses the CEO's chosen SLA threshold and on/off toggles
-- (both fall back to their code defaults once dropped). Revert the code too,
-- or the table/columns are re-created lazily on the next request.
DROP TABLE IF EXISTS crm_assignment_settings;
ALTER TABLE crm_assignment_rule_state DROP COLUMN current_weights;
ALTER TABLE crm_assignment_rules DROP COLUMN max_open_leads_per_employee;
ALTER TABLE crm_assignment_rules DROP COLUMN employee_weights;
