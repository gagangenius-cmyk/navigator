export type DiscountStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** A row of GET /api/discount-approvals (crm_discount_approvals joined with lead + employees). */
export interface DiscountApproval {
  id: number;
  leadId: number;
  opportunityId: number | null;
  discountType: string | null;
  discountAmount: number | string;
  originalAmount: number | string;
  discountedAmount: number | string;
  currency: string | null;
  reason: string | null;
  status: DiscountStatus | string;
  requestedBy: number;
  requestedDate: string | null;
  approvedAt: string | null;
  rejectedDate: string | null;
  createdAt: string | null;
  fname: string | null;
  lname: string | null;
  email: string | null;
  mobile: string | null;
  opportunityName: string | null;
  requestedEmployeeName: string | null;
  approvedEmployeeName: string | null;
}

export interface DiscountSummary {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

/** Discount as a percentage of the original amount (0 when the original is unknown). */
export function discountPercent(row: Pick<DiscountApproval, 'discountAmount' | 'originalAmount'>): number {
  const amount = Number(row.discountAmount);
  const original = Number(row.originalAmount);
  if (!Number.isFinite(amount) || !Number.isFinite(original) || original <= 0) return 0;
  return Math.round((amount / original) * 1000) / 10;
}
