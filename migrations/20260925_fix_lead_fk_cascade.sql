-- crm_forum_leads carried 4 foreign keys inherited from the original legacy
-- database dump, all four ON DELETE CASCADE (confirmed live via
-- information_schema.REFERENTIAL_CONSTRAINTS - not something
-- migrations/20260914_core_fk_constraints.sql touched, since that pass was
-- specifically about tables with ZERO FK protection, not fixing an
-- already-present but dangerous rule on this one):
--   fk_assignto    (assignTo)    -> crm_employee(id)  ON DELETE CASCADE
--   fk_caseofficer (case_officer)-> crm_employee(id)  ON DELETE CASCADE
--   fk_counsilor   (Counsilor)   -> crm_employee(id)  ON DELETE CASCADE
--   fk_branch      (branch)      -> crm_branch(id)    ON DELETE CASCADE
--
-- CASCADE here means deleting a single employee row silently deletes every
-- lead ever assigned to them as counselor/case officer/owner, and deleting
-- a branch silently deletes every lead that branch ever had - by far the
-- most destructive FK behavior in this schema, on its single largest and
-- most important table.
--
-- New rules:
--   assignTo/case_officer/Counsilor -> SET NULL. All three are already
--   nullable on crm_forum_leads (CrmcForumLeads.ts declares each as
--   `number | null`), so losing the employee just orphans that reference -
--   the lead itself, and its history, survives untouched.
--   branch -> RESTRICT. branch is NOT NULL on crm_forum_leads (a lead must
--   always belong to a branch) - RESTRICT means a branch with any leads at
--   all simply cannot be deleted until they're explicitly reassigned or
--   removed first, matching the same "you cannot delete an employee/branch
--   that still has real history without dealing with it explicitly"
--   philosophy already established in migrations/20260914_core_fk_constraints.sql.
ALTER TABLE crm_forum_leads DROP FOREIGN KEY fk_assignto;
ALTER TABLE crm_forum_leads ADD CONSTRAINT fk_assignto FOREIGN KEY (assignTo) REFERENCES crm_employee(id) ON DELETE SET NULL;

ALTER TABLE crm_forum_leads DROP FOREIGN KEY fk_caseofficer;
ALTER TABLE crm_forum_leads ADD CONSTRAINT fk_caseofficer FOREIGN KEY (case_officer) REFERENCES crm_employee(id) ON DELETE SET NULL;

ALTER TABLE crm_forum_leads DROP FOREIGN KEY fk_counsilor;
ALTER TABLE crm_forum_leads ADD CONSTRAINT fk_counsilor FOREIGN KEY (Counsilor) REFERENCES crm_employee(id) ON DELETE SET NULL;

ALTER TABLE crm_forum_leads DROP FOREIGN KEY fk_branch;
ALTER TABLE crm_forum_leads ADD CONSTRAINT fk_branch FOREIGN KEY (branch) REFERENCES crm_branch(id) ON DELETE RESTRICT;
