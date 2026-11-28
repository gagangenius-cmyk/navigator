// Types and constants shared by the Opportunity Flow wizard and its lazily loaded stages.
import { type Installment } from '@/lib/installments';

export interface FlowStage {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  status: 'pending' | 'current' | 'completed' | 'rejected';
}

export interface ProspectData {
  opportunityName: string;
  opportunityType: string;
  estimatedValue: string;
  priority: string;
  description: string;
  serviceRequired: string;
  serviceId: string;
}

export interface QuotationData {
  quotationNumber: string;
  validUntil: string;
  items: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    total: string;
  }>;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  terms: string;
}

export interface PaymentData {
  paymentStructure: 'full' | 'installment' | 'milestone';
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  paymentMethod: string;
  transactionId: string;
  paymentDate: string;
  proofOfPayment: File | null;
  proofOfPaymentUrl: string | null;
  dueDate: string;
  remark: string;
  adminFeeIncluded: boolean;
  includeVat: boolean;
  installments: Installment[];
}

export interface DocumentData {
  idProof: File | null;
  passportCopy: File | null;
  passportNumber: string;
  clientActualName: string;
  additionalInfo: string;
  allMandatoryDocsUploaded: boolean;
  // Populated from /api/opportunity-documents when a doc was uploaded in an
  // earlier session (idProof/passportCopy only ever hold in-memory File
  // objects, gone after any remount) - keyed by document category, so the
  // Documents stage can link back to what's already on file instead of
  // showing a blank re-upload box with no sign anything was ever uploaded.
  uploadedDocUrls: Record<string, string>;
}

export interface AgreementData {
  agreementId?: number | null;
  agreementNumber?: string | null;
  agreementType: string;
  agreementTitle: string;
  duration: string;
  startDate: string;
  endDate: string;
  amount: string;
  terms: string;
  specialConditions: string;
  status: 'draft' | 'generated' | 'sent';
  companyName?: string;
  companyAddress?: string;
  counselorConversationSummary: string;
}

export interface SignedAgreementData {
  clientSignature: string;
  signatureDate: string;
  documentUrl: string;
  uploadedTocrm: boolean;
}

export interface RetentionData {
  retentionStatus: 'pending' | 'approved' | 'rejected';
  complianceManager: string;
  reviewNotes: string;
  reviewDate: string;
  discountApprovalId: number | null;
  discountStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  complianceApprovalId: number | null;
  agreementComplianceStatus: 'not_submitted' | 'pending' | 'approved' | 'rejected';
  reassignmentId: number | null;
  notes: string;
}

export const COUNSELOR_SUMMARY_MIN_CHARS = 100;
