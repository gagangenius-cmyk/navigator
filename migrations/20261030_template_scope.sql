-- Enterprise template scope (company > branch > role) for crm_message_templates.
-- Applied automatically at runtime by src/lib/ensureTemplateScopeColumns.ts
-- (called from connectDB); this file is the manual equivalent.
ALTER TABLE crm_message_templates
  ADD COLUMN scope_level ENUM('company','branch','role') NOT NULL DEFAULT 'company',
  ADD COLUMN role_id INT NULL,
  ADD COLUMN base_template_id INT NULL;

UPDATE crm_message_templates SET scope_level = 'branch' WHERE branch_id IS NOT NULL;
