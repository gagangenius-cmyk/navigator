-- Enterprise round-robin upgrades to the existing Lead Assignment Rules
-- engine (docs/LEAD_ASSIGNMENT_ROUND_ROBIN.md): weighted rotation, per-agent
-- capacity caps, and a CEO-editable automation-settings row.
--
-- Also self-provisioned lazily (src/lib/assignmentRuleEngine.ts's
-- ensureWeightingColumns, src/lib/assignmentSettings.ts's
-- ensureAssignmentSettingsTable); this file is for fresh-install parity.
-- Duplicate-column/table errors are tolerated by scripts/setup-database.js.
-- Rollback: migrations/rollback/20261005_assignment_rules_enterprise.down.sql
ALTER TABLE crm_assignment_rules ADD COLUMN employee_weights VARCHAR(2000) NULL;
ALTER TABLE crm_assignment_rules ADD COLUMN max_open_leads_per_employee INT NULL;

-- True smooth-weighted-round-robin state (per-candidate running counter,
-- JSON-encoded) - needed for correctness once any rule uses weighting; see
-- pickWeighted() in src/lib/assignmentRuleEngine.ts for why a simple
-- "last employee id" cursor alone isn't sufficient once a candidate can
-- legitimately receive consecutive or repeated turns.
ALTER TABLE crm_assignment_rule_state ADD COLUMN current_weights TEXT NULL;

CREATE TABLE IF NOT EXISTS crm_assignment_settings (
  id INT NOT NULL PRIMARY KEY DEFAULT 1,
  round_robin_enabled TINYINT NOT NULL DEFAULT 1,
  sla_sweep_enabled TINYINT NOT NULL DEFAULT 1,
  pool_sla_minutes INT NOT NULL DEFAULT 30,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT NULL
);

INSERT INTO crm_assignment_settings (id, round_robin_enabled, sla_sweep_enabled, pool_sla_minutes)
VALUES (1, 1, 1, 30)
ON DUPLICATE KEY UPDATE id = id;
