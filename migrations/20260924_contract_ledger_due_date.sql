-- Adds due_date/demand_amt to crm_contract_ledger (migrations/20260923_contracts_schema.sql)
-- so reports that need "what's due and when" (e.g. the recovery report) can
-- read it straight off the ledger instead of falling back to raw joins.
-- Purely additive to the view's SELECT list - existing consumers that don't
-- reference these two columns are unaffected.
CREATE OR REPLACE VIEW crm_contract_ledger AS
SELECT
  c.id                                    AS contractId,
  c.contract_number                       AS contractNumber,
  c.lead_id                               AS leadId,
  c.opportunity_id                        AS opportunityId,
  c.branch_id                             AS branchId,
  c.region_id                             AS regionId,
  c.service_id                            AS serviceId,
  c.program_type_id                       AS programTypeId,
  c.country_interest                      AS countryInterest,
  c.pay_total                             AS payTotal,
  c.discount                              AS discount,
  c.paid_yet                              AS paidYet,
  c.pay_balance                           AS payBalance,
  c.novat                                 AS novat,
  c.status                                AS contractStatus,
  c.status_date                           AS statusDate,
  c.agree_date                            AS agreeDate,
  c.due_date                              AS dueDate,
  c.demand_amt                            AS demandAmt,
  c.created_at                            AS createdAt,
  0                                       AS isLegacy
FROM crm_contracts c
WHERE c.is_deleted = 0

UNION ALL

SELECT
  NULL                                    AS contractId,
  CONCAT('LEGACY-', l.id)                 AS contractNumber,
  l.id                                    AS leadId,
  l.opportunity_id                        AS opportunityId,
  l.branch                                AS branchId,
  l.region                                AS regionId,
  CAST(l.service_interest AS UNSIGNED)    AS serviceId,
  CAST(l.service_interest AS UNSIGNED)    AS programTypeId,
  CAST(l.country_interest AS UNSIGNED)    AS countryInterest,
  l.payTotal                              AS payTotal,
  l.discount                              AS discount,
  COALESCE(l.paidYet, 0)                  AS paidYet,
  l.payBalance                            AS payBalance,
  l.novat                                 AS novat,
  l.status                                AS contractStatus,
  l.status_date                           AS statusDate,
  l.agreeDate                             AS agreeDate,
  l.dueDate                               AS dueDate,
  l.demandAmt                             AS demandAmt,
  l.created                               AS createdAt,
  1                                       AS isLegacy
FROM crm_forum_leads l
WHERE NOT EXISTS (SELECT 1 FROM crm_contracts c2 WHERE c2.lead_id = l.id);
