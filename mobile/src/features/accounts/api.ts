import { api, toPage, type Page, type RawPagination } from '@/services/api/client';
import type { BalanceRow, PaymentReviewStatus, PaymentVerification } from './types';

const PAYMENT_PERMISSIONS = ['finance.view', 'finance.manage', 'payments.view'];

export async function fetchPaymentVerifications(
  status: PaymentReviewStatus | 'all',
  page = 1,
  limit = 25,
): Promise<Page<PaymentVerification>> {
  const response = await api.get<{ data: PaymentVerification[]; pagination?: RawPagination }>(
    '/api/admin/payment-verification',
    { query: { status: status === 'all' ? undefined : status, page, limit }, requires: PAYMENT_PERMISSIONS },
  );
  return toPage(response.data, response.pagination, page);
}

/**
 * Accounts verification of a submitted payment. `verified` also moves the finance gate
 * forward on the server (and may auto-create the agreement); `rejected` bounces it back
 * to the counselor with the remarks.
 */
export function decidePayment(
  paymentId: number | string,
  decision: 'verified' | 'rejected',
  remarks: string | null,
): Promise<{ success?: boolean }> {
  return api.put('/api/admin/opportunity-payments/verify', { paymentId, status: decision, remarks }, { requires: PAYMENT_PERMISSIONS });
}

export async function fetchBalances(page = 1, search?: string, limit = 20): Promise<Page<BalanceRow>> {
  const response = await api.get<{ data: BalanceRow[]; pagination?: RawPagination }>('/api/admin/balance-payments', {
    query: { page, limit, search },
  });
  return toPage(response.data, response.pagination, page);
}
