-- Makes crm_forum_leads.status admin-configurable instead of a hardcoded
-- string list scattered across a dozen files. Replaces the old disposition
-- vocabulary (Prospect, Not Interested, DNQ, Not_answered, Could Not
-- Connect, Call Back, Abroad Lead, Junk, Duplicate, retained, client,
-- converted) with exactly 7 values, each a row here rather than a literal
-- string in component code. 'untouched' and 'New' are NOT included — those
-- are lifecycle sentinels (unassigned queue / just-assigned) managed
-- entirely in application code (see src/lib/leadRemarks.ts
-- recordLeadAssignment), never part of the user-facing disposition dropdown
-- either before or after this change.
--
-- uses_p_priority_scale replaces the old hardcoded "status === 'Prospect' ?
-- show P1-P4 : show High/Medium/Low" checks — only 'Hot' sets it, so the
-- Priority field switches to the P1-P4 scale exactly when a lead is Hot,
-- without any status name being hardcoded into the priority-switching logic
-- itself (an admin could flip this flag onto a different status later with
-- no code change).
--
-- badge_class / kanban_accent_class / kanban_tint_class carry ready-to-use
-- Tailwind classes so status badges and Kanban columns render entirely from
-- this table too, with no per-status color mapping left in component code.
CREATE TABLE IF NOT EXISTS crm_lead_status (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(50) NOT NULL,
  badge_class VARCHAR(100) NOT NULL DEFAULT 'bg-gray-100 text-gray-800',
  kanban_accent_class VARCHAR(50) NOT NULL DEFAULT 'bg-slate-400',
  kanban_tint_class VARCHAR(100) NOT NULL DEFAULT 'border-slate-200 bg-slate-50/70',
  uses_p_priority_scale TINYINT(1) NOT NULL DEFAULT 0,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_crm_lead_status_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO crm_lead_status
  (name, badge_class, kanban_accent_class, kanban_tint_class, uses_p_priority_scale, sort_order) VALUES
  ('Hot',      'bg-red-100 text-red-800',       'bg-red-500',    'border-red-100 bg-red-50/60',    1, 10),
  ('Warm',     'bg-orange-100 text-orange-800', 'bg-orange-500', 'border-orange-100 bg-orange-50/60', 0, 20),
  ('DNP',      'bg-amber-100 text-amber-800',   'bg-amber-500',  'border-amber-100 bg-amber-50/60', 0, 30),
  ('Cold',     'bg-blue-100 text-blue-800',     'bg-blue-500',   'border-blue-100 bg-blue-50/60',   0, 40),
  ('Junk',     'bg-stone-100 text-stone-700',   'bg-stone-500',  'border-stone-200 bg-stone-50/70', 0, 50),
  ('Dead',     'bg-gray-200 text-gray-700',     'bg-gray-500',   'border-gray-200 bg-gray-50/70',   0, 60),
  ('Enrolled', 'bg-green-100 text-green-800',   'bg-green-500',  'border-green-100 bg-green-50/60', 0, 70);

-- One-time migration of existing crm_forum_leads.status values to the new
-- vocabulary. 'untouched'/'New' are intentionally left untouched (no
-- disposition assigned yet, not part of this taxonomy). Each mapping below
-- is idempotent — safe to re-run.
UPDATE crm_forum_leads SET status = 'Hot'      WHERE status IN ('Prospect', 'Qualified');
UPDATE crm_forum_leads SET status = 'Warm'     WHERE status IN ('Call Back', 'Abroad Lead', 'Contacted');
UPDATE crm_forum_leads SET status = 'DNP'      WHERE status IN ('Not_answered', 'Could Not Connect');
UPDATE crm_forum_leads SET status = 'Cold'     WHERE status = 'Not Interested';
UPDATE crm_forum_leads SET status = 'Junk'     WHERE status = 'DNQ';
UPDATE crm_forum_leads SET status = 'Dead'     WHERE status IN ('Duplicate', 'Closed');
UPDATE crm_forum_leads SET status = 'Enrolled' WHERE status IN ('retained', 'client', 'converted');
