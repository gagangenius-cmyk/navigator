-- Broadcast Center / Template Library / Visual Workflow Automation / Bot
-- Builder - Phase 1 schema (see docs/broadcast-architecture.md for the full
-- integration plan this migration implements).
--
-- Conventions followed (matching migrations/20260923_contracts_schema.sql,
-- the most recent large multi-table migration in this repo):
--   * crm_ prefix, snake_case columns, InnoDB, utf8mb4.
--   * created_at/updated_at DATETIME with CURRENT_TIMESTAMP defaults; soft
--     delete via is_deleted/deleted_at where a row can meaningfully be
--     "deleted" by a user (templates, segments, campaigns, workflows).
--   * FK ON DELETE: RESTRICT for mandatory attribution or a mandatory link
--     to another record this feature can't function without; SET NULL for
--     nullable "nice to know" attribution; CASCADE only for a strict
--     parent/child pair where the child has no meaning without the parent
--     (e.g. a campaign's recipients, a workflow's step executions).
--   * "tenant/project" from the broadcast-automation spec maps to this
--     CRM's existing branch_id (crm_branch.id) - there is no separate
--     project concept here (see docs/broadcast-architecture.md section 2).
--   * "contact" maps to crm_forum_leads.id, the CRM's actual core lead
--     record (NOT crm_clients/crm_prospects - see architecture doc).
--   * Safe to run more than once (CREATE TABLE IF NOT EXISTS), matching
--     scripts/setup-database.js's idempotent-by-structure migration runner.
--
-- Two columns are deliberately NOT foreign-key-constrained even though they
-- reference another table in this same file:
--   crm_message_templates.current_draft_version_id / current_published_version_id
--   crm_workflow_definitions.current_draft_version_id / current_published_version_id
-- Each points at a row in a *_versions table that in turn has a mandatory FK
-- back to its parent (template_id / workflow_id). Constraining both
-- directions would require creating the tables out of dependency order (or
-- a deferred ALTER after both exist); the pointer is app-enforced instead
-- (only ever set to a version_id that was just inserted for this same
-- parent), the same tradeoff already accepted for started_at/ended_at style
-- "soft" references elsewhere in this codebase.
--
-- Rollback: migrations/rollback/20261001_broadcast_automation_schema.down.sql
-- (kept in a rollback/ subdirectory specifically so scripts/setup-database.js's
-- non-recursive `fs.readdirSync(migrations/).filter(f => f.endsWith('.sql'))`
-- never auto-applies it).

-- ── 1. Messaging integrations ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_messaging_integrations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL COMMENT 'NULL = company-wide integration, not branch-scoped',
  channel ENUM('email','whatsapp','sms') NOT NULL,
  provider VARCHAR(50) NOT NULL COMMENT 'e.g. resend, meta_whatsapp_cloud, twilio',
  account_label VARCHAR(255) NOT NULL,
  account_metadata JSON NULL COMMENT 'non-secret account info: phone_number_id, from_address, sender_id',
  credential_ref TEXT NULL COMMENT 'ciphertext from src/lib/encryption.ts (AES-256-GCM) - never plaintext',
  capabilities JSON NULL COMMENT 'e.g. {"templates": true, "media": true}',
  status ENUM('active','disabled','error') NOT NULL DEFAULT 'active',
  last_health_check_at DATETIME NULL,
  last_health_status VARCHAR(50) NULL,
  created_by INT NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_msgint_branch_channel (branch_id, channel),
  INDEX idx_msgint_status (status),
  CONSTRAINT fk_msgint_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE SET NULL,
  CONSTRAINT fk_msgint_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Consent (current state + append-only history) ────────────────────────
CREATE TABLE IF NOT EXISTS crm_contact_channel_consents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  channel ENUM('email','whatsapp','sms') NOT NULL,
  purpose VARCHAR(50) NOT NULL DEFAULT 'marketing' COMMENT 'marketing, transactional, etc.',
  address VARCHAR(255) NULL COMMENT 'snapshot of the email/phone this consent record applies to',
  consent_state ENUM('opted_in','opted_out','unknown') NOT NULL DEFAULT 'unknown',
  source VARCHAR(100) NULL COMMENT 'e.g. lead_form, manual, import, reply_stop',
  proof TEXT NULL COMMENT 'evidence reference: form submission id, message id, recording url',
  opted_in_at DATETIME NULL,
  opted_out_at DATETIME NULL,
  updated_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_consent_lead_channel_purpose (lead_id, channel, purpose),
  INDEX idx_consent_state (channel, consent_state),
  CONSTRAINT fk_consent_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_consent_updated_by FOREIGN KEY (updated_by) REFERENCES crm_employee(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_contact_consent_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  channel ENUM('email','whatsapp','sms') NOT NULL,
  purpose VARCHAR(50) NOT NULL DEFAULT 'marketing',
  event_type ENUM('opt_in','opt_out') NOT NULL,
  source VARCHAR(100) NULL,
  proof TEXT NULL,
  actor_id INT NULL COMMENT 'employee who recorded this; NULL if system/automated (e.g. a STOP reply)',
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_consent_events_lead (lead_id, channel),
  CONSTRAINT fk_consent_events_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_consent_events_actor FOREIGN KEY (actor_id) REFERENCES crm_employee(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Suppression list ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_message_suppressions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NULL COMMENT 'nullable: an address can be suppressed even when not tied to a known lead',
  channel ENUM('email','whatsapp','sms') NOT NULL,
  address_hash CHAR(64) NOT NULL COMMENT 'SHA-256 of the normalized address - the raw address is never stored here',
  reason ENUM('unsubscribed','bounced','complained','manual','invalid') NOT NULL,
  source VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_suppression_channel_address (channel, address_hash),
  INDEX idx_suppression_lead (lead_id),
  CONSTRAINT fk_suppression_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Audience segments ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_contact_segments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  filter_ast JSON NOT NULL COMMENT 'validated filter tree - never raw SQL from the client',
  owner_id INT NOT NULL,
  is_shared TINYINT NOT NULL DEFAULT 0 COMMENT 'visible to the whole branch, not just the owner',
  last_estimated_count INT NULL,
  last_estimated_at DATETIME NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_segments_branch (branch_id),
  INDEX idx_segments_owner (owner_id),
  CONSTRAINT fk_segments_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE SET NULL,
  CONSTRAINT fk_segments_owner FOREIGN KEY (owner_id) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Template library ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_message_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  channel ENUM('email','whatsapp','sms') NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NULL COMMENT 'WhatsApp: MARKETING/UTILITY/AUTHENTICATION; email/sms: free-form label',
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  folder VARCHAR(255) NULL,
  tags JSON NULL,
  provider_template_id VARCHAR(128) NULL COMMENT 'Meta WABA template id once submitted/imported',
  status ENUM('draft','pending_review','approved','rejected','archived') NOT NULL DEFAULT 'draft',
  current_draft_version_id INT NULL COMMENT 'not FK-constrained - see file header note',
  current_published_version_id INT NULL COMMENT 'not FK-constrained - see file header note',
  owner_id INT NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_templates_branch_channel_name (branch_id, channel, name),
  INDEX idx_templates_status (status),
  INDEX idx_templates_channel (channel),
  CONSTRAINT fk_templates_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE SET NULL,
  CONSTRAINT fk_templates_owner FOREIGN KEY (owner_id) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_message_template_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  version_number INT NOT NULL,
  channel ENUM('email','whatsapp','sms') NOT NULL COMMENT 'denormalized from the parent template for query convenience',
  components JSON NOT NULL COMMENT 'structured channel-specific body: WhatsApp component array, SMS text, email subject/preheader block',
  design_json JSON NULL COMMENT 'Unlayer canonical design source (email only) - the editable source of truth',
  export_html LONGTEXT NULL COMMENT 'sanitized rendered HTML (email only) - rendering/send source only, never hand-edited',
  export_text LONGTEXT NULL COMMENT 'plain-text alternative (email) or the WhatsApp/SMS body text',
  variable_schema JSON NULL COMMENT 'variable definitions: name, type, required, sample',
  sample_values JSON NULL,
  content_hash CHAR(64) NOT NULL COMMENT 'SHA-256 of components+design_json, for change detection and dedup',
  is_published TINYINT NOT NULL DEFAULT 0 COMMENT 'immutable once 1 - a published version is never UPDATEd, only superseded by a new version row',
  published_at DATETIME NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_versions_template_number (template_id, version_number),
  INDEX idx_template_versions_template (template_id),
  CONSTRAINT fk_template_versions_template FOREIGN KEY (template_id) REFERENCES crm_message_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_template_versions_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_message_template_status_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  template_version_id INT NULL,
  provider_event_id VARCHAR(128) NULL COMMENT 'dedup key for provider webhooks that redeliver the same status twice; NULL for manual/internal events',
  event_type ENUM('submitted','approved','rejected','disabled','quality_update','flagged') NOT NULL,
  provider_status VARCHAR(50) NULL,
  rejection_reason TEXT NULL,
  quality_rating VARCHAR(50) NULL,
  raw_payload JSON NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_status_provider_event (provider_event_id),
  INDEX idx_template_status_template (template_id),
  CONSTRAINT fk_template_status_template FOREIGN KEY (template_id) REFERENCES crm_message_templates(id) ON DELETE CASCADE,
  CONSTRAINT fk_template_status_version FOREIGN KEY (template_version_id) REFERENCES crm_message_template_versions(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. Broadcast campaigns ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_broadcast_campaigns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  channel ENUM('email','whatsapp','sms') NOT NULL,
  name VARCHAR(255) NOT NULL,
  template_version_id INT NOT NULL,
  segment_id INT NULL,
  segment_snapshot JSON NULL COMMENT 'filter AST + recipient count frozen at launch time, for audit',
  variable_mapping JSON NULL COMMENT 'template variable name -> lead field / static value',
  scheduled_at_utc DATETIME NULL,
  scheduled_timezone VARCHAR(64) NULL COMMENT 'IANA tz the user picked, e.g. Asia/Dubai - scheduled_at_utc is the execution source of truth',
  status ENUM('draft','scheduled','preflight','launching','running','paused','completed','cancelled','failed') NOT NULL DEFAULT 'draft',
  published_config_hash CHAR(64) NULL COMMENT 'hash of the full launch config, set once status leaves draft - config is immutable from that point on',
  total_recipients INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  delivered_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  replied_count INT NOT NULL DEFAULT 0,
  launched_at DATETIME NULL,
  paused_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  completed_at DATETIME NULL,
  cancel_reason TEXT NULL,
  created_by INT NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_campaigns_branch_status (branch_id, status),
  INDEX idx_campaigns_scheduled (status, scheduled_at_utc),
  CONSTRAINT fk_campaigns_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE SET NULL,
  CONSTRAINT fk_campaigns_template_version FOREIGN KEY (template_version_id) REFERENCES crm_message_template_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_campaigns_segment FOREIGN KEY (segment_id) REFERENCES crm_contact_segments(id) ON DELETE SET NULL,
  CONSTRAINT fk_campaigns_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_broadcast_recipients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campaign_id INT NOT NULL,
  lead_id INT NULL,
  channel ENUM('email','whatsapp','sms') NOT NULL,
  address_snapshot VARCHAR(255) NOT NULL COMMENT 'email/phone captured at snapshot time - immutable even if the lead record changes later',
  template_version_id INT NOT NULL,
  rendered_variables JSON NULL,
  status ENUM('pending','queued','sent','delivered','read','replied','failed','skipped_suppressed','skipped_consent','skipped_cancelled') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  provider_message_id VARCHAR(191) NULL,
  claimed_at DATETIME NULL COMMENT 'lease timestamp - a worker claims a row before sending so a crashed worker can be safely re-claimed after a timeout',
  claimed_by VARCHAR(100) NULL COMMENT 'worker/process identifier holding the lease',
  idempotency_key CHAR(64) NOT NULL COMMENT 'deterministic hash of (campaign_id, lead_id, channel) - the single source of truth preventing a double-send on retry',
  failure_reason TEXT NULL,
  sent_at DATETIME NULL,
  delivered_at DATETIME NULL,
  read_at DATETIME NULL,
  replied_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_recipients_idempotency (idempotency_key),
  UNIQUE KEY uq_recipients_campaign_lead_channel (campaign_id, lead_id, channel),
  INDEX idx_recipients_campaign_status (campaign_id, status),
  INDEX idx_recipients_claim (status, claimed_at),
  CONSTRAINT fk_recipients_campaign FOREIGN KEY (campaign_id) REFERENCES crm_broadcast_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_recipients_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_recipients_template_version FOREIGN KEY (template_version_id) REFERENCES crm_message_template_versions(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_broadcast_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient_id INT NOT NULL,
  campaign_id INT NOT NULL COMMENT 'denormalized from recipient for query convenience',
  event_type ENUM('accepted','sent','delivered','read','replied','bounced','complained','failed','opted_out') NOT NULL,
  provider_event_id VARCHAR(191) NULL COMMENT 'webhook dedup key - NULL for internally-generated events',
  raw_payload JSON NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_broadcast_events_provider_event (provider_event_id),
  INDEX idx_broadcast_events_recipient (recipient_id),
  INDEX idx_broadcast_events_campaign (campaign_id, event_type),
  CONSTRAINT fk_broadcast_events_recipient FOREIGN KEY (recipient_id) REFERENCES crm_broadcast_recipients(id) ON DELETE CASCADE,
  CONSTRAINT fk_broadcast_events_campaign FOREIGN KEY (campaign_id) REFERENCES crm_broadcast_campaigns(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. Visual workflow automation (also backs the bot builder - see workflow_type) ──
CREATE TABLE IF NOT EXISTS crm_workflow_definitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  workflow_type ENUM('automation','bot') NOT NULL DEFAULT 'automation',
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  current_draft_version_id INT NULL COMMENT 'not FK-constrained - see file header note',
  current_published_version_id INT NULL COMMENT 'not FK-constrained - see file header note',
  owner_id INT NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflow_defs_branch_type (branch_id, workflow_type),
  INDEX idx_workflow_defs_status (status),
  CONSTRAINT fk_workflow_defs_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE SET NULL,
  CONSTRAINT fk_workflow_defs_owner FOREIGN KEY (owner_id) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_workflow_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT NOT NULL,
  version_number INT NOT NULL,
  graph_json JSON NOT NULL COMMENT 'nodes + edges, validated at write time (Phase 4 Zod node registry)',
  schema_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  validation_hash CHAR(64) NOT NULL COMMENT 'SHA-256 of graph_json, for change detection',
  is_published TINYINT NOT NULL DEFAULT 0 COMMENT 'immutable once 1 - never UPDATEd, only superseded by a new version row',
  published_at DATETIME NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_workflow_versions_workflow_number (workflow_id, version_number),
  INDEX idx_workflow_versions_workflow (workflow_id),
  CONSTRAINT fk_workflow_versions_workflow FOREIGN KEY (workflow_id) REFERENCES crm_workflow_definitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_workflow_versions_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_workflow_enrollments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  workflow_version_id INT NOT NULL,
  lead_id INT NULL,
  subject_type VARCHAR(50) NOT NULL DEFAULT 'lead' COMMENT 'what kind of record this enrollment is about',
  correlation_id CHAR(36) NOT NULL COMMENT 'UUID tying together this run''s step executions/waits/outbox rows, and used to propagate cancellation',
  enrollment_policy_key VARCHAR(191) NULL COMMENT 'dedup key preventing duplicate enrollment for the same trigger+subject, e.g. sha256(workflow_id:lead_id:trigger_event_id)',
  status ENUM('active','waiting','completed','cancelled','failed') NOT NULL DEFAULT 'active',
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME NULL,
  cancel_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_enrollments_policy_key (enrollment_policy_key),
  UNIQUE KEY uq_enrollments_correlation (correlation_id),
  INDEX idx_enrollments_workflow_version (workflow_version_id, status),
  INDEX idx_enrollments_lead (lead_id),
  CONSTRAINT fk_enrollments_workflow_version FOREIGN KEY (workflow_version_id) REFERENCES crm_workflow_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_enrollments_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_workflow_step_executions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  node_id VARCHAR(191) NOT NULL COMMENT 'node id from graph_json - not a DB foreign key',
  node_type VARCHAR(100) NOT NULL,
  attempt INT NOT NULL DEFAULT 1,
  status ENUM('pending','claimed','waiting','succeeded','failed','skipped','cancelled') NOT NULL DEFAULT 'pending',
  input_snapshot JSON NULL,
  output_snapshot JSON NULL,
  idempotency_key CHAR(64) NOT NULL COMMENT 'sha256(enrollment_id:node_id:attempt) - prevents duplicate side effects on at-least-once delivery',
  claimed_at DATETIME NULL,
  claimed_by VARCHAR(100) NULL,
  error_message TEXT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_step_exec_idempotency (idempotency_key),
  INDEX idx_step_exec_enrollment (enrollment_id, status),
  INDEX idx_step_exec_claim (status, claimed_at),
  CONSTRAINT fk_step_exec_enrollment FOREIGN KEY (enrollment_id) REFERENCES crm_workflow_enrollments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_workflow_waits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  enrollment_id INT NOT NULL,
  step_execution_id INT NOT NULL,
  wait_type ENUM('duration','until','event') NOT NULL,
  event_correlation_key VARCHAR(191) NULL COMMENT 'what inbound event resumes this wait, e.g. sha256(enrollment_id:expected_event_type)',
  deadline_at DATETIME NULL,
  timeout_action ENUM('fail','skip','continue_via_timeout_branch') NOT NULL DEFAULT 'continue_via_timeout_branch',
  status ENUM('waiting','resumed','timed_out','cancelled') NOT NULL DEFAULT 'waiting',
  resumed_at DATETIME NULL,
  resumed_by_event_id INT NULL COMMENT 'points at crm_bot_messages.id or crm_broadcast_events.id depending on what resumed it - not FK-constrained since it can reference either table',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_waits_enrollment (enrollment_id),
  INDEX idx_waits_poll (status, deadline_at),
  INDEX idx_waits_event_key (event_correlation_key),
  CONSTRAINT fk_waits_enrollment FOREIGN KEY (enrollment_id) REFERENCES crm_workflow_enrollments(id) ON DELETE CASCADE,
  CONSTRAINT fk_waits_step_exec FOREIGN KEY (step_execution_id) REFERENCES crm_workflow_step_executions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 8. Conversational bot sessions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_bot_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NULL,
  channel ENUM('whatsapp','sms') NOT NULL COMMENT 'real-time conversational channels only - email is not a session channel',
  lead_id INT NULL,
  address VARCHAR(255) NOT NULL COMMENT 'phone number the session is keyed on',
  workflow_version_id INT NOT NULL,
  enrollment_id INT NULL,
  current_node_id VARCHAR(191) NULL,
  session_state JSON NULL COMMENT 'captured field values and current branch context',
  status ENUM('active','handed_off','completed','expired','opted_out') NOT NULL DEFAULT 'active',
  handoff_at DATETIME NULL,
  handoff_agent_id INT NULL,
  handoff_reason TEXT NULL,
  expires_at DATETIME NULL,
  last_inbound_at DATETIME NULL COMMENT 'drives the WhatsApp 24h customer-service-window check (see src/lib/whatsapp.ts)',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bot_sessions_address (channel, address, status),
  INDEX idx_bot_sessions_lead (lead_id),
  CONSTRAINT fk_bot_sessions_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE SET NULL,
  CONSTRAINT fk_bot_sessions_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_bot_sessions_workflow_version FOREIGN KEY (workflow_version_id) REFERENCES crm_workflow_versions(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bot_sessions_enrollment FOREIGN KEY (enrollment_id) REFERENCES crm_workflow_enrollments(id) ON DELETE SET NULL,
  CONSTRAINT fk_bot_sessions_handoff_agent FOREIGN KEY (handoff_agent_id) REFERENCES crm_employee(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_bot_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  lead_id INT NULL,
  direction ENUM('inbound','outbound') NOT NULL,
  message_type VARCHAR(50) NOT NULL DEFAULT 'text' COMMENT 'text, button_reply, quick_reply, template, media',
  body TEXT NULL,
  payload JSON NULL,
  provider_message_id VARCHAR(191) NULL,
  dedup_key CHAR(64) NOT NULL COMMENT 'sha256 of provider_message_id (inbound) or session_id:node_id:attempt (outbound) - guards against duplicate webhook delivery',
  node_id VARCHAR(191) NULL COMMENT 'bot flow node this outbound message came from, if any',
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bot_messages_dedup (dedup_key),
  INDEX idx_bot_messages_session (session_id, occurred_at),
  INDEX idx_bot_messages_lead (lead_id),
  CONSTRAINT fk_bot_messages_session FOREIGN KEY (session_id) REFERENCES crm_bot_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_bot_messages_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 9. Transactional outbox + audit log ──────────────────────────────────────
-- Deliberately a separate table from the existing crm_job_queue
-- (src/lib/jobQueue.ts), not a reuse of it: this needs aggregate_type/
-- aggregate_id/dedupe_key fields the generic job queue doesn't have, and
-- Phase 3/4/5's outbox rows are semantically "one durable fact about a
-- broadcast recipient or workflow step", not a generic background job. Its
-- *execution* will still be driven by the same node-cron heartbeat
-- mechanism as crm_job_queue (see docs/broadcast-architecture.md's "Runtime
-- decision" section for why this project is not adopting Redis/BullMQ) -
-- this is a schema-only distinction, not a second queue infrastructure.
CREATE TABLE IF NOT EXISTS crm_automation_outbox (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL COMMENT 'e.g. campaign.send_recipient, workflow.execute_step, workflow.evaluate_wait',
  aggregate_type VARCHAR(50) NOT NULL COMMENT 'broadcast_recipient, workflow_step_execution, workflow_wait',
  aggregate_id INT NOT NULL,
  payload JSON NOT NULL,
  dedupe_key CHAR(64) NOT NULL,
  publish_state ENUM('pending','published','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  run_after DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error TEXT NULL,
  published_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_outbox_dedupe (dedupe_key),
  INDEX idx_outbox_poll (publish_state, run_after),
  INDEX idx_outbox_aggregate (aggregate_type, aggregate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_automation_audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  actor_id INT NULL COMMENT 'NULL for system/automated actions',
  action VARCHAR(100) NOT NULL COMMENT 'e.g. campaign.launched, template.published, workflow.published, workflow.rolled_back',
  branch_id INT NULL,
  object_type VARCHAR(50) NOT NULL,
  object_id INT NOT NULL,
  metadata JSON NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_automation_audit_object (object_type, object_id),
  INDEX idx_automation_audit_actor (actor_id, occurred_at),
  CONSTRAINT fk_automation_audit_actor FOREIGN KEY (actor_id) REFERENCES crm_employee(id) ON DELETE SET NULL,
  CONSTRAINT fk_automation_audit_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
