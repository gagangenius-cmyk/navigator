import { api, toPage, type Page, type RawPagination } from '@/services/api/client';
import type { DiscountApproval, DiscountStatus, DiscountSummary } from './types';

interface DiscountListResponse {
  success: boolean;
  data: DiscountApproval[];
  pagination?: RawPagination;
  summary?: DiscountSummary;
}

export interface DiscountList extends Page<DiscountApproval> {
  summary: DiscountSummary;
}

const EMPTY_SUMMARY: DiscountSummary = { total: 0, pending: 0, approved: 0, rejected: 0 };

export async function fetchDiscounts(status: DiscountStatus | 'all', page = 1, limit = 25): Promise<DiscountList> {
  const response = await api.get<DiscountListResponse>('/api/discount-approvals', {
    query: { status: status === 'all' ? undefined : status, page, limit },
  });
  return { ...toPage(response.data, response.pagination, page), summary: response.summary ?? EMPTY_SUMMARY };
}

/**
 * Approve or reject a request. The server decides whether this user may act on this
 * tier (auto / manager / CEO) and refuses a maker approving their own request.
 */
export function decideDiscount(id: number, decision: 'approved' | 'rejected'): Promise<{ success: boolean }> {
  return api.put(`/api/discount-approvals/${id}`, { status: decision });
}

export interface CreateDiscountInput {
  leadId: number;
  opportunityId?: number | null;
  discountType: 'fixed' | 'percentage';
  discountAmount: number;
  originalAmount: number;
  reason: string;
}

interface CreateDiscountResponse {
  success: boolean;
  message: string;
  data: { id: number; status: DiscountStatus; tier: string };
}

/**
 * Requests a discount. currency is resolved server-side from the requester's own
 * branch, not sent here. 0-20% (of originalAmount) auto-approves and applies
 * immediately; above that it queues for Branch Manager/CEO sign-off per the
 * server's tier thresholds.
 */
export function createDiscount(input: CreateDiscountInput): Promise<CreateDiscountResponse> {
  return api.post<CreateDiscountResponse>('/api/discount-approvals', {
    leadId: input.leadId,
    opportunityId: input.opportunityId ?? undefined,
    discountType: input.discountType,
    discountAmount: input.discountAmount,
    originalAmount: input.originalAmount,
    reason: input.reason.trim(),
  });
}
