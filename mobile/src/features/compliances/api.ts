import { api } from '@/services/api/client';
import type { SessionUser } from '@/features/auth/types';
import type { ComplianceApproval, ComplianceStatus } from './types';

interface ComplianceListResponse {
  success: boolean;
  data: ComplianceApproval[];
}

/** The endpoint is not paginated; the app caps what it renders. */
export async function fetchComplianceApprovals(status: ComplianceStatus | 'all'): Promise<ComplianceApproval[]> {
  const response = await api.get<ComplianceListResponse>('/api/opportunity-compliance-approvals', {
    query: { status: status === 'all' ? undefined : status },
    requires: ['agreements.view', 'documents.view'],
  });
  return response.data ?? [];
}

/**
 * Sign off (approve) or reject a signed agreement. Sends the same audit fields as the web
 * page. Only the CEO and the manager tier are accepted server-side, and non-CEO reviewers
 * only for their own branch.
 */
export function decideCompliance(
  id: number,
  decision: 'approved' | 'rejected',
  reviewNotes: string | null,
  reviewer: Pick<SessionUser, 'name' | 'roleName'>,
): Promise<{ success: boolean }> {
  return api.put(
    `/api/opportunity-compliance-approvals?id=${id}`,
    {
      status: decision,
      reviewedBy: reviewer.name,
      reviewerRole: reviewer.roleName,
      reviewNotes,
      reviewedAt: new Date().toISOString(),
    },
    {},
  );
}
