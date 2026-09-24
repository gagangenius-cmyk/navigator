import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/constants/queryKeys';
import { fetchPaymentVerifications } from '@/features/accounts/api';
import { canApproveDiscounts, canReviewCompliance, canVerifyPayments } from '@/features/auth/rbac';
import { fetchComplianceApprovals } from '@/features/compliances/api';
import { fetchDiscounts } from '@/features/discounts/api';
import { useOfflineQuery } from '@/services/db/useOfflineQuery';
import type { ApprovalKind } from '@/services/push/router';
import { selectUser, useSessionStore } from '@/store/sessionStore';
import type { StatusFilter } from './decisionRules';

const PAGE_SIZE = 50;

export function useDiscountList(filter: StatusFilter, enabled = true) {
  const user = useSessionStore(selectUser);
  return useOfflineQuery({
    queryKey: queryKeys.discounts(filter),
    cacheKey: `approvals:discounts:${filter}`,
    queryFn: () => fetchDiscounts(filter, 1, PAGE_SIZE),
    enabled: enabled && canApproveDiscounts(user),
  });
}

export function usePaymentList(filter: StatusFilter, enabled = true) {
  const user = useSessionStore(selectUser);
  return useOfflineQuery({
    queryKey: queryKeys.payments(filter),
    cacheKey: `approvals:payments:${filter}`,
    queryFn: () => fetchPaymentVerifications(filter === 'approved' ? 'verified' : filter, 1, PAGE_SIZE),
    enabled: enabled && canVerifyPayments(user),
  });
}

export function useComplianceList(filter: StatusFilter, enabled = true) {
  const user = useSessionStore(selectUser);
  return useOfflineQuery({
    queryKey: queryKeys.compliance(filter),
    cacheKey: `approvals:compliance:${filter}`,
    queryFn: async () => (await fetchComplianceApprovals(filter)).slice(0, PAGE_SIZE),
    enabled: enabled && canReviewCompliance(user),
  });
}

export type ApprovalCounts = Record<ApprovalKind, number> & { total: number };

/**
 * Pending counts for the tab badge and the segment badges. Cheap queries (page size 1
 * where the endpoint paginates) refreshed every minute while the app is open; a push
 * invalidates them immediately.
 */
export function useApprovalCounts(): ApprovalCounts {
  const user = useSessionStore(selectUser);

  const discounts = useQuery({
    queryKey: [...queryKeys.approvalSummary, 'discount'],
    queryFn: async () => (await fetchDiscounts('pending', 1, 1)).summary.pending,
    enabled: canApproveDiscounts(user),
    refetchInterval: 60_000,
  });
  const payments = useQuery({
    queryKey: [...queryKeys.approvalSummary, 'payment'],
    queryFn: async () => (await fetchPaymentVerifications('pending', 1, 1)).total,
    enabled: canVerifyPayments(user),
    refetchInterval: 60_000,
  });
  const compliance = useQuery({
    queryKey: [...queryKeys.approvalSummary, 'compliance'],
    queryFn: async () => (await fetchComplianceApprovals('pending')).length,
    enabled: canReviewCompliance(user),
    refetchInterval: 60_000,
  });

  const counts = {
    discount: discounts.data ?? 0,
    payment: payments.data ?? 0,
    compliance: compliance.data ?? 0,
  };
  return { ...counts, total: counts.discount + counts.payment + counts.compliance };
}
