-- Meta Lead Ads auto-sync: discovered forms + auto-generated mappings + campaign name on leads.
-- The app applies all of this itself on first use (src/lib/meta/sync.ts
-- ensureMetaSyncSchema and src/lib/ensureMetaCampaignNameColumn.ts), so running
-- this file is optional. MariaDB/MySQL: re-running ADD COLUMN errors if it already exists.

CREATE TABLE IF NOT EXISTS crm_meta_forms (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_id VARCHAR(64) NOT NULL,
  page_id VARCHAR(64) NULL,
  form_name VARCHAR(255) NULL,
  status VARCHAR(32) NULL,
  locale VARCHAR(16) NULL,
  questions JSON NULL,
  question_count INT NOT NULL DEFAULT 0,
  auto_mapped_count INT NOT NULL DEFAULT 0,
  meta_created_time DATETIME NULL,
  last_synced_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mf_form_id (form_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE crm_meta_lead_mappings ADD COLUMN auto_generated TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE crm_meta_settings ADD COLUMN last_auto_sync_at DATETIME NULL;
ALTER TABLE crm_meta_settings ADD COLUMN last_auto_sync_summary TEXT NULL;
ALTER TABLE crm_meta_settings ADD COLUMN webhook_subscribed_at DATETIME NULL;
ALTER TABLE crm_forum_leads ADD COLUMN meta_campaign_name VARCHAR(255) NULL;
