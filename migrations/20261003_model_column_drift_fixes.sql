-- Columns that Sequelize models / API routes already use but that were missing
-- from crm_next (found by scripts/audit-model-columns.ts). Additive only.
--
-- 1) crm_forum_leads: the CrmcForumLeads model selects these on every
--    unguarded findAll/findByPk, so their absence failed with
--    "Unknown column 'sf' in 'field list'" (reports, enhanced leads list,
--    untouched leads, payments/process, opportunities/create, ...).
-- 2) crm_hr_employee_documents: migrations/20260614_hr_pro_modules.sql created
--    it with file_name/file_url, but the HR documents routes, the v1 API and
--    the HrEmployeeDocument model use document_url/expiry_date/notes/created_at.
--    file_url was NOT NULL with no default, which made every insert that only
--    supplies document_url fail in strict mode, so it becomes nullable.
--
-- Duplicate-column errors are tolerated by scripts/setup-database.js.
-- Rollback: migrations/rollback/20261003_model_column_drift_fixes.down.sql
ALTER TABLE crm_forum_leads ADD COLUMN sf INT NOT NULL DEFAULT 0;
ALTER TABLE crm_forum_leads ADD COLUMN budget_range VARCHAR(100) NULL;
ALTER TABLE crm_forum_leads ADD COLUMN timeline VARCHAR(100) NULL;
ALTER TABLE crm_forum_leads ADD COLUMN decision_maker VARCHAR(255) NULL;
ALTER TABLE crm_forum_leads ADD COLUMN decision_maker_title VARCHAR(255) NULL;
ALTER TABLE crm_forum_leads ADD COLUMN decision_maker_contact VARCHAR(255) NULL;
ALTER TABLE crm_forum_leads ADD COLUMN next_followup_date DATETIME NULL;
ALTER TABLE crm_forum_leads ADD COLUMN opportunity_notes TEXT NULL;
ALTER TABLE crm_forum_leads ADD COLUMN tags VARCHAR(500) NULL;

ALTER TABLE crm_hr_employee_documents ADD COLUMN document_url VARCHAR(500) NULL;
ALTER TABLE crm_hr_employee_documents ADD COLUMN expiry_date DATE NULL;
ALTER TABLE crm_hr_employee_documents ADD COLUMN notes TEXT NULL;
ALTER TABLE crm_hr_employee_documents ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE crm_hr_employee_documents MODIFY COLUMN file_url VARCHAR(500) NULL;
