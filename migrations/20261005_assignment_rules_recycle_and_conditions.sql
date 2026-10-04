-- Three further enterprise upgrades to the Lead Assignment Rules engine
-- (docs/LEAD_ASSIGNMENT_ROUND_ROBIN.md): campaign/status rule conditions,
-- per-employee "always available" overrides to the daily check-in gate, and
-- hours-based stale-lead recycling.
--
-- Also self-provisioned lazily (src/lib/assignmentRuleEngine.ts's
-- ensureWeightingColumns, src/lib/ensureAssignedByRuleColumn.ts); this file
-- is for fresh-install parity. Duplicate-column errors are tolerated by
-- scripts/setup-database.js.
-- Rollback: migrations/rollback/20261005_assignment_rules_recycle_and_conditions.down.sql
ALTER TABLE crm_assignment_rules ADD COLUMN campaigns VARCHAR(1000) NULL;
ALTER TABLE crm_assignment_rules ADD COLUMN statuses VARCHAR(500) NULL;
ALTER TABLE crm_assignment_rules ADD COLUMN always_available_employee_ids VARCHAR(500) NULL;
ALTER TABLE crm_assignment_rules ADD COLUMN stale_recycle_hours INT NULL;

-- Which rule (if any) produced crm_forum_leads.assignTo's current value -
-- the stale-lead recycle sweep (src/lib/staleLeadRecycle.ts) only ever
-- recycles a lead through the same rule that assigned it, never a manual
-- pick or a different rule.
ALTER TABLE crm_forum_leads ADD COLUMN assigned_by_rule_id INT NULL;
