export type PaymentStructure = 'full' | 'installment' | 'milestone';
export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'cheque' | 'online';

export interface SubmitPaymentInput {
  leadId: number;
  /** What the opportunity is called and which service it's for - required by the server. */
  opportunityName: string;
  serviceRequired: string;
  /** Pre-discount total. */
  totalAmount: number;
  discountAmount?: number;
  paidAmount: number;
  paymentStructure: PaymentStructure;
  paymentMethod: PaymentMethod;
  transactionId?: string;
  /** ISO date. */
  paymentDate: string;
  /** From uploadPaymentProof() - required by the server whenever paidAmount > 0. */
  proofOfPaymentUrl?: string;
  remark?: string;
}

export interface SubmitPaymentResult {
  success: boolean;
  message: string;
  data: {
    opportunity: { id: number; opportunityNumber?: string | null };
    lead: { id: number; name: string | null };
  };
}
