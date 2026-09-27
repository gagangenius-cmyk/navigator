import { decidePayment } from '@/features/accounts/api';
import { decideCompliance } from '@/features/compliances/api';
import { decideDiscount } from '@/features/discounts/api';
import type { SessionUser } from '@/features/auth/types';
import type { ApprovalKind } from '@/services/push/router';
import type { Decision } from './decisionRules';

export interface DecisionRequest {
  approval: ApprovalKind;
  decision: Decision;
  recordId: string;
  notes: string | null;
  user: SessionUser;
}

/**
 * Sends a decision to the endpoint for its approval type. Callers must have already
 * confirmed with biometrics (ConfirmDecisionScreen) - nothing else in the app calls this.
 */
export async function submitDecision({ approval, decision, recordId, notes, user }: DecisionRequest): Promise<void> {
  const approve = decision === 'approve';
  switch (approval) {
    case 'discount':
      await decideDiscount(Number(recordId), approve ? 'approved' : 'rejected');
      return;
    case 'payment':
      await decidePayment(recordId, approve ? 'verified' : 'rejected', notes);
      return;
    case 'compliance':
      await decideCompliance(Number(recordId), approve ? 'approved' : 'rejected', notes, user);
      return;
  }
}
