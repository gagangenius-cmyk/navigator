-- Multi-contract lead model: a lead can now have multiple contracts, each
-- from its own branch, with its own service/program/payment terms,
-- agreement, and receipts. Every contract traces back to exactly one
-- CrmcOpportunities row (opportunity_id is NOT NULL + UNIQUE below), so
-- existing discount-approval and finance/compliance workflow-review
-- governance (both keyed by opportunity_id) applies unchanged to contracts
-- without needing to be duplicated. See CrmContract.ts / CrmContractAgreement.ts
-- / CrmContractReceipt.ts / CrmContractPaymentSchedule.ts for the matching
-- Sequelize models.
--
-- Deliberately additive/non-destructive: no existing table is altered in a
-- breaking way, no data is migrated, and crm_forum_leads' own flat payment
-- fields are untouched and keep working exactly as before for every lead
-- that has zero rows in crm_contracts (see the crm_contract_ledger view at
-- the bottom, which is what lets reports treat both "shapes" uniformly).
--
-- FK ON DELETE choices follow the same philosophy already established in
-- migrations/20260914_core_fk_constraints.sql: RESTRICT for mandatory
-- attribution or a mandatory link to another money/legal record, SET NULL
-- for nullable "nice to know" attribution.

CREATE TABLE IF NOT EXISTS crm_contracts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  opportunity_id INT NOT NULL,
  contract_number VARCHAR(50) NOT NULL,
  branch_id INT NOT NULL,
  region_id INT NULL,
  country_interest INT NULL,
  service_id INT NULL,
  program_type_id INT NULL,
  contract_type VARCHAR(50) NOT NULL DEFAULT 'individual',
  currency VARCHAR(10) NOT NULL DEFAULT 'AED',
  exchange_rate_to_aed DECIMAL(12,6) NOT NULL DEFAULT 1,
  pay_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_yet DECIMAL(15,2) NOT NULL DEFAULT 0,
  pay_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  pay_type VARCHAR(55) NULL,
  demand_amt DECIMAL(15,2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  demd_remark TEXT NULL,
  fee_agree_date DATE NULL,
  agree_date DATE NULL,
  ren_date DATE NULL,
  ren_expiry_date DATE NULL,
  renew_type VARCHAR(50) NULL,
  novat TINYINT NOT NULL DEFAULT 0,
  advanced TINYINT NOT NULL DEFAULT 0,
  status ENUM('draft','active','completed','cancelled','on_hold') NOT NULL DEFAULT 'draft',
  status_date DATE NOT NULL,
  is_deleted TINYINT NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  counselor_id INT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contracts_number (contract_number),
  UNIQUE KEY uq_contracts_opportunity (opportunity_id),
  INDEX idx_contracts_lead (lead_id),
  INDEX idx_contracts_lead_branch (lead_id, branch_id),
  INDEX idx_contracts_branch (branch_id),
  CONSTRAINT fk_contracts_lead FOREIGN KEY (lead_id) REFERENCES crm_forum_leads(id) ON DELETE RESTRICT,
  CONSTRAINT fk_contracts_opportunity FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities(id) ON DELETE RESTRICT,
  CONSTRAINT fk_contracts_branch FOREIGN KEY (branch_id) REFERENCES crm_branch(id) ON DELETE RESTRICT,
  CONSTRAINT fk_contracts_region FOREIGN KEY (region_id) REFERENCES crm_region(id) ON DELETE SET NULL,
  CONSTRAINT fk_contracts_service FOREIGN KEY (service_id) REFERENCES crm_service(id) ON DELETE SET NULL,
  CONSTRAINT fk_contracts_program_type FOREIGN KEY (program_type_id) REFERENCES crm_program_type(id) ON DELETE SET NULL,
  CONSTRAINT fk_contracts_counselor FOREIGN KEY (counselor_id) REFERENCES crm_employee(id) ON DELETE SET NULL,
  CONSTRAINT fk_contracts_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_contract_agreements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL,
  agreement_number VARCHAR(50) NOT NULL,
  agreement_type VARCHAR(100) NOT NULL,
  template_id INT NULL,
  agreement_title VARCHAR(255) NULL,
  title VARCHAR(255) NULL,
  description TEXT NULL,
  duration VARCHAR(50) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'AED',
  terms TEXT NULL,
  terms_and_conditions TEXT NULL,
  special_conditions TEXT NULL,
  content LONGTEXT NULL,
  status ENUM('draft','generated','sent','signed','uploaded','expired') NOT NULL DEFAULT 'draft',
  generated_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_date DATETIME NULL,
  signed_date DATETIME NULL,
  client_signature TEXT NULL,
  signature_date DATETIME NULL,
  document_url VARCHAR(500) NULL,
  client_name VARCHAR(255) NULL,
  client_email VARCHAR(255) NULL,
  client_phone VARCHAR(80) NULL,
  company_name VARCHAR(255) NULL,
  company_address TEXT NULL,
  uploaded_to_crm TINYINT NOT NULL DEFAULT 0,
  uploaded_by INT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_contract_agreements_number (agreement_number),
  INDEX idx_contract_agreements_contract (contract_id),
  CONSTRAINT fk_contract_agreements_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_contract_agreements_uploaded_by FOREIGN KEY (uploaded_by) REFERENCES crm_employee(id) ON DELETE SET NULL,
  CONSTRAINT fk_contract_agreements_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_contract_receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL,
  receipt_number VARCHAR(50) NOT NULL,
  payment_number VARCHAR(50) NOT NULL,
  payment_structure ENUM('full','installment','milestone') NOT NULL DEFAULT 'full',
  payment_type VARCHAR(100) NULL,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  amount DECIMAL(15,2) NULL,
  paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  remaining_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  balance_amount DECIMAL(15,2) NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'AED',
  exchange_rate_to_aed DECIMAL(12,6) NOT NULL DEFAULT 1,
  payment_method VARCHAR(50) NOT NULL,
  transaction_id VARCHAR(255) NULL,
  payment_date DATETIME NOT NULL,
  status ENUM('pending','processing','completed','paid','failed','refunded') NOT NULL DEFAULT 'pending',
  due_date DATETIME NULL,
  installment_number INT NULL,
  total_installments INT NULL,
  milestone_name VARCHAR(255) NULL,
  gateway VARCHAR(50) NULL,
  gateway_transaction_id VARCHAR(255) NULL,
  receipt_url VARCHAR(500) NULL,
  description TEXT NULL,
  receipt_type VARCHAR(50) NULL,
  client_name VARCHAR(255) NULL,
  client_email VARCHAR(255) NULL,
  client_phone VARCHAR(80) NULL,
  client_address TEXT NULL,
  service_name VARCHAR(255) NULL,
  branch_name VARCHAR(255) NULL,
  consultant_name VARCHAR(255) NULL,
  tax_amount DECIMAL(15,2) NULL DEFAULT 0,
  discount_amount DECIMAL(15,2) NULL DEFAULT 0,
  notes TEXT NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  accountant_status VARCHAR(20) NULL DEFAULT 'pending',
  accountant_remarks TEXT NULL,
  accountant_id INT NULL,
  accountant_verified_at DATETIME NULL,
  UNIQUE KEY uq_contract_receipts_receipt_number (receipt_number),
  UNIQUE KEY uq_contract_receipts_payment_number (payment_number),
  INDEX idx_contract_receipts_contract (contract_id),
  CONSTRAINT fk_contract_receipts_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_contract_receipts_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE RESTRICT,
  CONSTRAINT fk_contract_receipts_accountant FOREIGN KEY (accountant_id) REFERENCES crm_employee(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_contract_payment_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT NOT NULL,
  installment_number INT NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  status ENUM('pending','paid','overdue','cancelled') NOT NULL DEFAULT 'pending',
  paid_date DATE NULL,
  receipt_number VARCHAR(100) NULL,
  receipt_url VARCHAR(500) NULL,
  notes TEXT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_contract_payment_schedule_contract (contract_id),
  INDEX idx_contract_payment_schedule_status (status),
  CONSTRAINT fk_contract_payment_schedule_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts(id) ON DELETE RESTRICT,
  CONSTRAINT fk_contract_payment_schedule_created_by FOREIGN KEY (created_by) REFERENCES crm_employee(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A discount can now be requested against a specific contract (e.g. a
-- top-up/renewal on a contract that already exists, where re-opening the
-- original won opportunity doesn't make sense). Nullable: existing rows and
-- opportunity-level discount requests are unaffected.
ALTER TABLE crm_discount_approvals
  ADD COLUMN contract_id INT NULL AFTER opportunityId,
  ADD INDEX idx_discount_approvals_contract (contract_id),
  ADD CONSTRAINT fk_discount_approvals_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts(id) ON DELETE SET NULL;

-- Every crm_contract_receipts insert also dual-writes a crm_pay_history row
-- (mirroring the existing dual-write already done in
-- src/app/api/lead-to-opportunity/route.ts) so the many reports that already
-- read crm_pay_history directly need no rewrite. contract_id lets the
-- recovery-report/finance routes join back to the owning contract when one
-- exists.
ALTER TABLE crm_pay_history
  ADD COLUMN contract_id INT NULL AFTER leadId,
  ADD INDEX idx_pay_history_contract (contract_id),
  ADD CONSTRAINT fk_pay_history_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts(id) ON DELETE SET NULL;

-- curValue was clearly added to snapshot the exchange rate at payment time
-- (see crm_contract_receipts.exchange_rate_to_aed above, the same idea) but
-- has been hardcoded to the literal integer 0 by every writer to date
-- (src/app/api/receipts/route.ts, src/app/api/lead-to-opportunity/route.ts).
-- Widen it to match crm_contracts/crm_contract_receipts' rate precision so
-- it can finally be populated correctly going forward, instead of dropping
-- a column whose original intent was sound.
ALTER TABLE crm_pay_history
  MODIFY COLUMN curValue DECIMAL(12,6) NOT NULL DEFAULT 1;

-- Unified reporting shape: one row per real contract, plus one synthetic
-- "legacy contract" row for any lead that has zero rows in crm_contracts
-- (i.e. every lead created before this change, per the no-backfill
-- decision). Reports should read this view instead of crm_forum_leads
-- directly so a single "does this lead have a contract yet?" check
-- (the NOT EXISTS below) doesn't have to be duplicated in every report file.
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
  l.created                               AS createdAt,
  1                                       AS isLegacy
FROM crm_forum_leads l
WHERE NOT EXISTS (SELECT 1 FROM crm_contracts c2 WHERE c2.lead_id = l.id);
