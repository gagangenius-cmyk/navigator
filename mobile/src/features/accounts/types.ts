export type PaymentReviewStatus = 'pending' | 'verified' | 'rejected';

/** A row of GET /api/admin/payment-verification. */
export interface PaymentVerification {
  id: number | string;
  paymentNumber: string | null;
  totalAmount: number | string | null;
  paidAmount: number | string | null;
  remainingBalance: number | string | null;
  currency: string;
  paymentMethod: string | null;
  paymentDate: string | null;
  transactionId: string | null;
  proofOfPaymentUrl: string | null;
  status: string | null;
  accountantStatus: PaymentReviewStatus | string;
  accountantRemarks: string | null;
  accountantVerifiedAt: string | null;
  opportunityId: number | null;
  opportunityName: string | null;
  leadId: number | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  serviceName: string | null;
  createdAt: string | null;
}

/** A row of GET /api/admin/balance-payments (an opportunity with an outstanding balance). */
export interface BalanceRow {
  opportunityId: number;
  opportunityName: string | null;
  opportunityStatus: string | null;
  stage: string | null;
  leadId: number;
  fname: string | null;
  lname: string | null;
  email: string | null;
  phone: string | null;
  payTotal: number | string | null;
  paidYet: number | string | null;
  payBalance: number | string | null;
  dueDate: string | null;
  demdRemark: string | null;
  branchId: number | null;
  branchName: string | null;
  assignedEmployeeName: string | null;
  serviceName: string | null;
  agreementNumber: string | null;
  currencyCode: string;
}
