-- Closes the loop with Meta: lets the CRM report a lead's outcome
-- (contacted / qualified / converted / disqualified) back to Meta's
-- Conversions API, keyed by the leadgen_id captured at intake, so Meta's
-- delivery algorithm can learn which ads/audiences produce good leads.

-- 1. Link a CRM lead back to the Facebook leadgen_id it came from. Populated
--    by /api/web-to-leads when the inbound payload carries a MetaLeadId
--    (see src/lib/meta/mapping-engine.ts). Leads created any other way keep
--    this NULL, and the feedback feature simply no-ops for them.
ALTER TABLE crm_forum_leads ADD COLUMN meta_leadgen_id VARCHAR(64) NULL AFTER campaign_id;
CREATE INDEX idx_crm_forum_leads_meta_leadgen_id ON crm_forum_leads (meta_leadgen_id);

-- 2. Admin-editable dropdown: each row is one "Meta Lead Quality" option an
--    agent can pick, mapped to the Conversions API event Meta receives for
--    it. Seeded with sensible defaults — verify/adjust meta_event_name
--    against your own Meta Events Manager > Lead source > Lead Status setup
--    at /admin/meta-leads/quality-mappings before relying on this for
--    optimization, since Meta's exact recognized event names can vary by
--    account/dataset configuration.
CREATE TABLE IF NOT EXISTS crm_meta_quality_mappings (
  id INT NOT NULL AUTO_INCREMENT,
  quality_label VARCHAR(100) NOT NULL,
  meta_event_name VARCHAR(100) NOT NULL,
  meta_value DECIMAL(10,2) NULL,
  meta_currency VARCHAR(10) NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_crm_meta_quality_label (quality_label)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO crm_meta_quality_mappings (quality_label, meta_event_name, meta_value, meta_currency, is_enabled, sort_order) VALUES
  ('Contacted',     'Contact',          NULL, NULL, 1, 10),
  ('Qualified',     'Qualified Lead',   NULL, NULL, 1, 20),
  ('Converted',     'Purchase',         NULL, NULL, 1, 30),
  ('Not Interested','Disqualified Lead',NULL, NULL, 1, 40),
  ('Junk / Spam',   'Disqualified Lead',NULL, NULL, 1, 50);

-- 3. Audit log of every quality event actually sent to Meta, for the
--    delivery-logs admin view and for debugging mismatched attribution.
CREATE TABLE IF NOT EXISTS crm_meta_quality_events (
  id INT NOT NULL AUTO_INCREMENT,
  lead_id INT NOT NULL,
  meta_leadgen_id VARCHAR(64) NOT NULL,
  quality_label VARCHAR(100) NOT NULL,
  meta_event_name VARCHAR(100) NOT NULL,
  request_payload JSON NULL,
  response_status INT NULL,
  response_body TEXT NULL,
  success TINYINT(1) NOT NULL DEFAULT 0,
  error_message VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_meta_quality_events_lead (lead_id),
  KEY idx_crm_meta_quality_events_leadgen (meta_leadgen_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
