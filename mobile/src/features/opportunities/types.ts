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

/** The 3 mandatory document categories the web wizard's Documents stage requires,
 * plus the signed agreement itself - matches crm_opportunity_documents.category. */
export type DocumentCategory = 'id_proof' | 'passport' | 'counsellor_sheet' | 'signed_agreement';

export const DOCUMENT_CATEGORIES: { value: DocumentCategory; label: string }[] = [
  { value: 'id_proof', label: 'ID proof' },
  { value: 'passport', label: 'Passport copy' },
  { value: 'counsellor_sheet', label: 'Counsellor sheet' },
];

/** A row of GET /api/opportunity-documents?opportunityId=... */
export interface OpportunityDocument {
  id: number;
  opportunityId: number;
  category: DocumentCategory | string;
  documentName: string;
  filePath: string;
  status: string;
  uploadDate: string;
}

export interface SubmitComplianceInput {
  leadId: number;
  opportunityId: number;
  signedAgreementUrl: string;
  clientSignature?: string;
  /** ISO date. */
  signatureDate?: string;
  conversationSummary?: string;
}
