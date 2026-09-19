import { QueryTypes, type Transaction } from 'sequelize';
import { models, sequelize } from '@/models';

interface CreateOpportunityForContractParams {
  leadId: number;
  branchId: number;
  serviceName: string;
  totalAmount: number;
  createdBy: number;
  currency: string;
  transaction: Transaction;
}

// Every crm_contracts row traces back to exactly one crm_opportunities row
// (opportunity_id is NOT NULL + UNIQUE) so the existing discount-approval and
// finance/compliance workflow-review governance - both keyed by
// opportunity_id - applies to a contract exactly as it already does to an
// opportunity, without duplicating that machinery for contracts.
//
// Two entry points need this "won opportunity" to exist:
//   1. The full pipeline (src/app/admin/leads/opportunity-flow-wizard.tsx),
//      which already creates a real opportunity and just needs it marked won.
//   2. The express "Add Contract to Existing Lead" flow (the rebuilt
//      src/app/admin/leads/contract.tsx wizard), which has no opportunity at
//      all yet and needs a minimal one created transparently.
//
// This is a deliberately small, purpose-built helper - NOT a copy of
// src/app/api/lead-to-opportunity/route.ts's POST handler, which additionally
// validates a quotation against crm_fee package pricing, reverses VAT/discount
// math, and creates handover/accounting-verification/invoice records specific
// to the *new-lead sales pipeline*. None of that applies to "an existing,
// trusted client is buying another product" - the caller is responsible for
// whatever validation makes sense for its own entry point. Kept as a shared
// helper specifically so both entry points create the *same shape* of
// opportunity + workflow-review stub and can never drift apart on that piece.
export async function createOpportunityForContract({
  leadId,
  branchId,
  serviceName,
  totalAmount,
  createdBy,
  currency,
  transaction,
}: CreateOpportunityForContractParams): Promise<number> {
  const now = new Date();
  const opportunityNumber = `OPP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  // id is intentionally NOT set here — crm_opportunities.id is a real
  // AUTO_INCREMENT column (see the identical comment in
  // lead-to-opportunity/route.ts for why pre-computing it is unsafe).
  const opportunity = await models.CrmcOpportunities.create({
    leadId,
    opportunityNumber,
    opportunityName: serviceName,
    opportunityType: 'new_business',
    description: `Opportunity created for a new contract on lead #${leadId}`,
    serviceType: serviceName,
    serviceRequired: serviceName,
    estimatedValue: totalAmount,
    actualValue: totalAmount,
    currency,
    priority: 'medium',
    status: 'won',
    stage: 'won',
    probability: 100,
    assignedTo: createdBy,
    createdBy,
    source: 'contract_direct',
    conversionDate: now,
    branchId,
    expectedCloseDate: now,
    nextAction: '',
    tags: '',
    notes: '',
    agreementGenerated: true,
    agreementSent: false,
    agreementSigned: false,
    paymentReceived: false,
    documentsVerified: false,
    createdAt: now,
    updatedAt: now,
  }, { transaction });
  Object.assign(opportunity, opportunity.get({ plain: true }));
  let opportunityId = Number(opportunity.id);
  if (!opportunityId) {
    // Sequelize's mysql2 dialect can come back with an unpopulated `id` on the
    // returned instance for this model even though the row itself is inserted
    // correctly with a real AUTO_INCREMENT value — same caveat documented in
    // lead-to-opportunity/route.ts. Fall back to the unique opportunityNumber.
    const idRows = await sequelize.query<{ id: number }>(
      'SELECT id FROM crm_opportunities WHERE opportunityNumber = ? ORDER BY id DESC LIMIT 1',
      { replacements: [opportunityNumber], transaction, type: QueryTypes.SELECT }
    );
    opportunityId = Number(idRows[0]?.id);
  }

  await sequelize.query(
    `INSERT INTO crm_opportunity_workflow_reviews
     (opportunity_id, lead_id, workflow_status, finance_status, compliance_status, created_at, updated_at)
     VALUES (?, ?, 'opportunity_created', 'pending', 'pending', ?, ?)`,
    { replacements: [opportunityId, leadId, now, now], transaction }
  );

  return opportunityId;
}
