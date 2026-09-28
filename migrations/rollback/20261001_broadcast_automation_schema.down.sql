-- Rollback for migrations/20261001_broadcast_automation_schema.sql.
--
-- NOT auto-applied: scripts/setup-database.js only reads *.sql files
-- directly inside migrations/ (fs.readdirSync is non-recursive), so this
-- rollback/ subdirectory is invisible to the normal `npm run db:setup` /
-- `npm run db:migrate` flow. Apply manually and deliberately:
--   mysql -u <user> -p <database> < migrations/rollback/20261001_broadcast_automation_schema.down.sql
--
-- This project has no migrations-tracking ledger (see
-- docs/broadcast-architecture.md), so there is no automated "have I already
-- rolled this back" guard - DROP TABLE IF EXISTS makes re-running this file
-- safe, but running it drops these tables and everything in them
-- unconditionally. All 19 tables in this migration are net-new (no existing
-- table is altered), so this rollback is a pure subtraction with zero risk
-- to any other CRM data.
--
-- Dropped in strict reverse-dependency order (children before parents).
-- FOREIGN_KEY_CHECKS is also disabled around the batch as a second layer of
-- safety in case that order is ever edited incorrectly.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS crm_automation_audit_logs;
DROP TABLE IF EXISTS crm_automation_outbox;

DROP TABLE IF EXISTS crm_bot_messages;
DROP TABLE IF EXISTS crm_bot_sessions;

DROP TABLE IF EXISTS crm_workflow_waits;
DROP TABLE IF EXISTS crm_workflow_step_executions;
DROP TABLE IF EXISTS crm_workflow_enrollments;
DROP TABLE IF EXISTS crm_workflow_versions;
DROP TABLE IF EXISTS crm_workflow_definitions;

DROP TABLE IF EXISTS crm_broadcast_events;
DROP TABLE IF EXISTS crm_broadcast_recipients;
DROP TABLE IF EXISTS crm_broadcast_campaigns;

DROP TABLE IF EXISTS crm_message_template_status_events;
DROP TABLE IF EXISTS crm_message_template_versions;
DROP TABLE IF EXISTS crm_message_templates;

DROP TABLE IF EXISTS crm_contact_segments;

DROP TABLE IF EXISTS crm_message_suppressions;

DROP TABLE IF EXISTS crm_contact_consent_events;
DROP TABLE IF EXISTS crm_contact_channel_consents;

DROP TABLE IF EXISTS crm_messaging_integrations;

SET FOREIGN_KEY_CHECKS = 1;
