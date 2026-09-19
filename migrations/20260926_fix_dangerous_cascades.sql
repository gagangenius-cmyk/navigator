-- Follow-up to migrations/20260925_fix_lead_fk_cascade.sql: a full sweep of
-- every FK constraint in the schema (89 total, confirmed live via
-- information_schema.REFERENTIAL_CONSTRAINTS) turned up two more dangerous
-- CASCADE clusters beyond the 4 already fixed on crm_forum_leads itself:
--
--   1. crm_employee.role -> crm_role ON DELETE CASCADE - deleting a role
--      silently deleted every employee who held that role.
--   2. Eight tables CASCADE off crm_forum_leads.id, including
--      crm_pay_history and crm_3party_payment - deleting a lead silently
--      destroyed its entire payment/receipt history, remarks, reassignment
--      history, contract documents, and assessments.
--
-- All changed to RESTRICT: a role/lead/branch/country/currency/service with
-- any real dependent history can no longer be deleted at all until that
-- history is explicitly handled first - the same "protect real history over
-- allowing an easy delete" philosophy as 20260914_core_fk_constraints.sql
-- and 20260925_fix_lead_fk_cascade.sql. Note this means the existing
-- hard-delete-a-lead endpoints (DELETE /api/leads/[id] etc.) will now fail
-- with an FK error for any lead that has payment history, remarks, a
-- reassignment, a contract on file, or an assessment/observation - by
-- design, not a bug.
--
-- crm_forum_leads_assesment_desgn/_edu's OTHER foreign key (skillId ->
-- crm_forum_leads_assesments) is left as CASCADE - it's a genuine dependent
-- child of the assessment record itself, not of the lead directly.
--
-- Also fixed while auditing the same crm_employee-adjacent cluster:
-- crm_immigration_tool_results and crm_ops_assignments both CASCADE off
-- crm_employee, and neither employee_id/assigned_to/assigned_by column is
-- nullable, so SET NULL isn't an option for them either - RESTRICT here
-- too. (crm_employee's own hard-delete code path is dead/unused today, so
-- this is a pre-emptive fix, not a live-breaking one.)
--
-- Left as CASCADE deliberately (genuinely dependent records with no
-- independent value, or pure join/state tables - not touched here):
-- crm_employee_mfa, crm_employee_targets, crm_notifications (already
-- documented as intentional), crm_branch_exchange_rate_map,
-- crm_meta_lead_deliveries, crm_assignment_rule_state, crm_role_permissions.

ALTER TABLE crm_employee DROP FOREIGN KEY dm_employee_role_fk;
ALTER TABLE crm_employee ADD CONSTRAINT dm_employee_role_fk FOREIGN KEY (role) REFERENCES crm_role(id) ON DELETE RESTRICT;

ALTER TABLE crm_pay_history DROP FOREIGN KEY crm_pay_history_ibfk_1;
ALTER TABLE crm_pay_history ADD CONSTRAINT crm_pay_history_ibfk_1 FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_3party_payment DROP FOREIGN KEY crm_3party_payment_ibfk_1;
ALTER TABLE crm_3party_payment ADD CONSTRAINT crm_3party_payment_ibfk_1 FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_remarks DROP FOREIGN KEY fk_dm_remarks_lead;
ALTER TABLE crm_remarks ADD CONSTRAINT fk_dm_remarks_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

-- `lead` is backtick-quoted below - it's a reserved word in MySQL 8 (the
-- LEAD() window function), which is why the original CREATE TABLE for this
-- column had to quote it too.
ALTER TABLE crm_forum_leads_remarks DROP FOREIGN KEY crm_forum_leads_remarks_ibfk_1;
ALTER TABLE crm_forum_leads_remarks ADD CONSTRAINT crm_forum_leads_remarks_ibfk_1 FOREIGN KEY (`lead`) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_lead_reassignments DROP FOREIGN KEY fk_lead_reassignments_lead;
ALTER TABLE crm_lead_reassignments ADD CONSTRAINT fk_lead_reassignments_lead FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_forum_leads_contracts DROP FOREIGN KEY crm_forum_leads_contracts_ibfk_1;
ALTER TABLE crm_forum_leads_contracts ADD CONSTRAINT crm_forum_leads_contracts_ibfk_1 FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_forum_leads_assesments DROP FOREIGN KEY crm_forum_leads_assesments_ibfk_1;
ALTER TABLE crm_forum_leads_assesments ADD CONSTRAINT crm_forum_leads_assesments_ibfk_1 FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_forum_leads_assesment_desgn DROP FOREIGN KEY crm_forum_leads_assesment_desgn_ibfk_2;
ALTER TABLE crm_forum_leads_assesment_desgn ADD CONSTRAINT crm_forum_leads_assesment_desgn_ibfk_2 FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_forum_leads_assesment_edu DROP FOREIGN KEY crm_forum_leads_assesment_edu_ibfk_2;
ALTER TABLE crm_forum_leads_assesment_edu ADD CONSTRAINT crm_forum_leads_assesment_edu_ibfk_2 FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_forum_leads_observations DROP FOREIGN KEY crm_forum_leads_observations_ibfk_1;
ALTER TABLE crm_forum_leads_observations ADD CONSTRAINT crm_forum_leads_observations_ibfk_1 FOREIGN KEY (leadId) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_immigration_tool_results DROP FOREIGN KEY fk_dm_immigration_tool_results_lead;
ALTER TABLE crm_immigration_tool_results ADD CONSTRAINT fk_dm_immigration_tool_results_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT;

ALTER TABLE crm_immigration_tool_results DROP FOREIGN KEY fk_dm_immigration_tool_results_employee;
ALTER TABLE crm_immigration_tool_results ADD CONSTRAINT fk_dm_immigration_tool_results_employee FOREIGN KEY (employee_id) REFERENCES crm_employee(id) ON DELETE RESTRICT;

ALTER TABLE crm_fee DROP FOREIGN KEY fkfee_branch_key;
ALTER TABLE crm_fee ADD CONSTRAINT fkfee_branch_key FOREIGN KEY (branch) REFERENCES crm_branch(id) ON DELETE RESTRICT;

ALTER TABLE crm_fee DROP FOREIGN KEY fkfee_country_key;
ALTER TABLE crm_fee ADD CONSTRAINT fkfee_country_key FOREIGN KEY (country) REFERENCES crm_country_proces(id) ON DELETE RESTRICT;

ALTER TABLE crm_fee DROP FOREIGN KEY fkfee_currency_key;
ALTER TABLE crm_fee ADD CONSTRAINT fkfee_currency_key FOREIGN KEY (currency) REFERENCES crm_currency(id) ON DELETE RESTRICT;

ALTER TABLE crm_fee DROP FOREIGN KEY fkfee_service_key;
ALTER TABLE crm_fee ADD CONSTRAINT fkfee_service_key FOREIGN KEY (service) REFERENCES crm_service(id) ON DELETE RESTRICT;

ALTER TABLE crm_employee_access_log DROP FOREIGN KEY fk_dm_employee_access_log_employee;
ALTER TABLE crm_employee_access_log ADD CONSTRAINT fk_dm_employee_access_log_employee FOREIGN KEY (employee_id) REFERENCES crm_employee(id) ON DELETE RESTRICT;

ALTER TABLE crm_employee_access_log DROP FOREIGN KEY fk_dm_employee_access_log_actor;
ALTER TABLE crm_employee_access_log ADD CONSTRAINT fk_dm_employee_access_log_actor FOREIGN KEY (actor_id) REFERENCES crm_employee(id) ON DELETE RESTRICT;

ALTER TABLE crm_ops_assignments DROP FOREIGN KEY fk_dm_ops_assignments_assigned_to;
ALTER TABLE crm_ops_assignments ADD CONSTRAINT fk_dm_ops_assignments_assigned_to FOREIGN KEY (assigned_to) REFERENCES crm_employee(id) ON DELETE RESTRICT;

ALTER TABLE crm_ops_assignments DROP FOREIGN KEY fk_dm_ops_assignments_assigned_by;
ALTER TABLE crm_ops_assignments ADD CONSTRAINT fk_dm_ops_assignments_assigned_by FOREIGN KEY (assigned_by) REFERENCES crm_employee(id) ON DELETE RESTRICT;
