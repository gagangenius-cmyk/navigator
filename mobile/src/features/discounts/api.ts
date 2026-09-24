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
