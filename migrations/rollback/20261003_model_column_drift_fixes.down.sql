-- Rollback for migrations/20261003_model_column_drift_fixes.sql.
--
-- NOT auto-applied (scripts/setup-database.js does not read rollback/).
-- Apply manually and deliberately. Dropping the crm_forum_leads columns
-- re-breaks every unguarded CrmcForumLeads query, and any data stored in them
-- (tags, opportunity notes, decision-maker details, ...) is lost. Restoring
-- file_url NOT NULL fails if any row has a NULL file_url.
ALTER TABLE crm_hr_employee_documents MODIFY COLUMN file_url VARCHAR(500) NOT NULL;
ALTER TABLE crm_hr_employee_documents DROP COLUMN created_at;
ALTER TABLE crm_hr_employee_documents DROP COLUMN notes;
ALTER TABLE crm_hr_employee_documents DROP COLUMN expiry_date;
ALTER TABLE crm_hr_employee_documents DROP COLUMN document_url;

ALTER TABLE crm_forum_leads DROP COLUMN tags;
ALTER TABLE crm_forum_leads DROP COLUMN opportunity_notes;
ALTER TABLE crm_forum_leads DROP COLUMN next_followup_date;
ALTER TABLE crm_forum_leads DROP COLUMN decision_maker_contact;
ALTER TABLE crm_forum_leads DROP COLUMN decision_maker_title;
ALTER TABLE crm_forum_leads DROP COLUMN decision_maker;
ALTER TABLE crm_forum_leads DROP COLUMN timeline;
ALTER TABLE crm_forum_leads DROP COLUMN budget_range;
ALTER TABLE crm_forum_leads DROP COLUMN sf;
