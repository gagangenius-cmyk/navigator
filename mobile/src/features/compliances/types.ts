export type ComplianceStatus = 'pending' | 'under_review' | 'approved' | 'rejected';

/** A row of GET /api/opportunity-compliance-approvals (approval + client, counselor, payment context). */
export interface ComplianceApproval {
  id: number;
  leadId: number;
  opportunityId: number | null;
  status: ComplianceStatus | string;
  signedAgreementUrl: string | null;
  submittedBy: string | number | null;
  submittedAt: string | null;
  reviewedBy: string | number | null;
  reviewerRole: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  counselorName: string | null;
  conversationSummary: string | null;
  clientCommitments: string | null;
  nextAction: string | null;
  paymentNumber: string | null;
  receiptNumber: string | null;
  paidAmount: number | string | null;
  totalAmount: number | string | null;
  currency: string | null;
  accountantStatus: string | null;
  proofOfPaymentUrl: string | null;
  counsellorSheetUrl: string | null;
}
