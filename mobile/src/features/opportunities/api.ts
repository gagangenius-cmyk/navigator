import { api } from '@/services/api/client';
import { uploadFile, type PickedFile } from '@/services/api/upload';
import type { SubmitPaymentInput, SubmitPaymentResult } from './types';

/**
 * Uploads proof of payment for a lead that doesn't have an opportunity yet (the
 * opportunity is created by submitPayment() below, which needs this URL first).
 */
export async function uploadPaymentProof(leadId: number, file: PickedFile): Promise<string> {
  const result = await uploadFile<{ url: string }>(`/api/leads/${leadId}/payment-proof`, file);
  return result.url;
}

/**
 * Converts a lead into an opportunity by submitting its first payment - mirrors the
 * web Opportunity Flow wizard's Payment stage (src/app/admin/leads/opportunity-flow-wizard.tsx
 * ensureOpportunityForClient()), which is also where crm_opportunities is first created.
 */
export function submitPayment(input: SubmitPaymentInput): Promise<SubmitPaymentResult> {
  return api.post<SubmitPaymentResult>(
    '/api/lead-to-opportunity',
    {
      leadId: input.leadId,
      opportunityData: {
        opportunityName: input.opportunityName,
        serviceRequired: input.serviceRequired,
        estimatedValue: input.totalAmount,
      },
      paymentData: {
        totalAmount: input.totalAmount,
        discountAmount: input.discountAmount ?? 0,
        paidAmount: input.paidAmount,
        amount: input.paidAmount,
        paymentStructure: input.paymentStructure,
        paymentMethod: input.paymentMethod,
        transactionId: input.transactionId || undefined,
        paymentDate: input.paymentDate,
        proofOfPaymentUrl: input.proofOfPaymentUrl || undefined,
        remark: input.remark || undefined,
        notes: input.remark || undefined,
      },
    },
    { requires: ['leads.view'] },
  );
}
