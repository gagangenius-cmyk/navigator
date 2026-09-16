/* eslint-disable @typescript-eslint/no-require-imports */
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ quiet: true });

const REQUIRED_COLUMNS = {
  crm_forum_leads: ['id', 'opportunity_id', 'opportunity_status', 'conversion_date', 'payTotal', 'paidYet', 'payBalance', 'discount'],
  crm_opportunities: [
    'id', 'leadId', 'opportunityNumber', 'opportunityName', 'estimatedValue', 'actualValue', 'currency',
    'status', 'stage', 'branchId', 'assignedTo', 'createdBy', 'agreementGenerated', 'agreementId',
    'agreementSent', 'agreementSigned', 'paymentReceived', 'documentsVerified',
  ],
  crm_opportunity_workflow_reviews: [
    'id', 'opportunity_id', 'lead_id', 'workflow_status', 'official_id_data', 'payment_data',
    'finance_status', 'finance_checklist', 'finance_reason', 'compliance_status',
    'compliance_checklist', 'compliance_reason', 'formal_client_id',
  ],
  crm_opportunity_payments: [
    'id', 'opportunityId', 'paymentNumber', 'receiptNumber', 'totalAmount', 'amount', 'paidAmount',
    'remainingBalance', 'balanceAmount', 'currency', 'paymentMethod', 'transactionId', 'paymentDate',
    'status', 'receiptUrl', 'receiptType', 'clientName', 'taxAmount', 'discountAmount',
    'accountantStatus', 'accountantRemarks', 'accountantId', 'accountantVerifiedAt',
  ],
  crm_opportunity_agreements: [
    'id', 'opportunityId', 'agreementNumber', 'agreementType', 'templateId', 'agreementTitle',
    'title', 'amount', 'totalAmount', 'currency', 'status', 'generatedDate', 'signedDate',
    'clientSignature', 'signatureDate', 'documentUrl', 'clientName', 'content',
  ],
  crm_discount_approvals: [
    'id', 'leadId', 'opportunityId', 'discountType', 'discountAmount', 'originalAmount',
    'discountedAmount', 'currency', 'reason', 'requestedBy', 'approvedBy', 'status',
    'is_deleted', 'superseded_by',
  ],
  crm_b2b_invoices: ['id', 'receipt', 'branch', 'company', 'totPayAmt', 'payBalance', 'amount', 'discount', 'status'],
  crm_forum_leads_contracts: ['id', 'leadId', 'contract', 'unsigned_contract', 'ar_contract', 'verify', 'payment_status'],
  crm_opportunity_handover_notes: ['id', 'lead_id', 'opportunity_id', 'counselor_id', 'conversation_summary', 'created_at'],
  crm_opportunity_accounting_verifications: ['id', 'lead_id', 'opportunity_id', 'payment_proof_url', 'payment_received', 'documents_complete', 'status'],
  crm_client_upload_portals: ['id', 'client_id', 'lead_id', 'opportunity_id', 'agreement_number', 'access_token', 'status'],
  crm_client_upload_checklist_items: ['id', 'portal_id', 'item_name', 'required', 'status'],
  crm_pay_history: [
    'id', 'leadId', 'amount', 'counselor_receipt', 'date', 'payMethod', 'payoption',
    'payBalance', 'tax', 'payCategory', 'payment_remarks', 'status', 'proof_url',
    'admin_fee_included', 'admin_fee_amount', 'refNumber', 'created_by', 'stage', 'totaltillnow',
  ],
};

const FIXES = {
  'crm_pay_history.proof_url': 'ALTER TABLE crm_pay_history ADD COLUMN proof_url VARCHAR(500) NULL AFTER status',
  'crm_pay_history.admin_fee_included': 'ALTER TABLE crm_pay_history ADD COLUMN admin_fee_included TINYINT(1) NOT NULL DEFAULT 0',
  'crm_pay_history.admin_fee_amount': 'ALTER TABLE crm_pay_history ADD COLUMN admin_fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00',
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const apply = process.argv.includes('--apply');
  const db = await mysql.createConnection(process.env.DATABASE_URL);

  try {
    const [[databaseRow]] = await db.query('SELECT DATABASE() AS db');
    console.log(`Connected database: ${databaseRow.db}`);

    const missing = [];
    for (const [table, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
      let columns;
      try {
        const [rows] = await db.query(`SHOW COLUMNS FROM \`${table}\``);
        columns = new Set(rows.map((row) => row.Field));
      } catch {
        missing.push(`${table}.*`);
        console.log(`MISSING TABLE ${table}`);
        continue;
      }

      const tableMissing = requiredColumns.filter((column) => !columns.has(column));
      if (tableMissing.length) {
        missing.push(...tableMissing.map((column) => `${table}.${column}`));
        console.log(`MISSING ${table}: ${tableMissing.join(', ')}`);
      } else {
        console.log(`OK ${table}`);
      }
    }

    if (apply) {
      const fixable = missing.filter((key) => FIXES[key]);
      for (const key of fixable) {
        await db.query(FIXES[key]);
        console.log(`FIXED ${key}`);
      }
      const unfixable = missing.filter((key) => !FIXES[key]);
      if (unfixable.length) {
        console.log(`UNFIXED: ${unfixable.join(', ')}`);
        process.exitCode = 1;
      }
    } else if (missing.length) {
      console.log(`Missing columns/tables: ${missing.join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('Opportunity flow database schema check passed.');
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error.code || error.name, error.message);
  process.exit(1);
});
