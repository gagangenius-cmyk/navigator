import type { SessionUser } from '@/features/auth/types';
import { canReceivePush } from './policy';
import { ACTIONS, DEFAULT_ACTION, type PushData } from './types';

// The single place a notification tap, an action-button press, a cold start from
// a notification and a foreground banner tap are all turned into "where to go".
// Pure and framework-free so every branch is unit tested.

export type ApprovalSegment = 'discounts' | 'payments' | 'compliance';
export type ApprovalKind = 'discount' | 'payment' | 'compliance';

export type PushTarget =
  | { kind: 'lead'; leadId: number }
  | { kind: 'call'; leadId: number; phone?: string }
  | { kind: 'approvals'; segment: ApprovalSegment; highlightId?: string }
  /** Opens the biometric-gated confirm sheet - never sends the decision by itself. */
  | { kind: 'decision'; approval: ApprovalKind; decision: 'approve' | 'reject'; recordId: string; leadId?: number };

const toId = (value?: string): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const SEGMENT_BY_TYPE = {
  discount_requested: 'discounts',
  payment_submission: 'payments',
  compliance_submission: 'compliance',
} as const;

const APPROVAL_BY_TYPE = {
  discount_requested: 'discount',
  payment_submission: 'payment',
  compliance_submission: 'compliance',
} as const;

function recordIdOf(data: PushData): string | undefined {
  switch (data.type) {
    case 'discount_requested':
      return data.discountApprovalId;
    case 'payment_submission':
      return data.paymentId;
    case 'compliance_submission':
      return data.complianceApprovalId;
    default:
      return undefined;
  }
}

/**
 * @param actionId which button was pressed (DEFAULT_ACTION for a tap on the body)
 * @returns the destination, or null when the payload is not for this user
 */
export function resolveNotificationRoute(
  data: PushData,
  user: SessionUser | null | undefined,
  actionId: string = DEFAULT_ACTION,
): PushTarget | null {
  if (!canReceivePush(data.type, user)) return null;

  if (data.type === 'lead_assigned') {
    const leadId = toId(data.leadId ?? data.relatedId);
    if (!leadId) return null;
    if (actionId === ACTIONS.call) return { kind: 'call', leadId, phone: data.phone };
    return { kind: 'lead', leadId };
  }

  const segment = SEGMENT_BY_TYPE[data.type];
  const approval = APPROVAL_BY_TYPE[data.type];
  const recordId = recordIdOf(data);
  const leadId = toId(data.leadId ?? data.relatedId) ?? undefined;

  // Approve / Reject / Sign-off: land on the confirm sheet for the exact record.
  // Without the record id (the server's lookup failed) fall back to the inbox,
  // where the user can still pick the request - never guess a record.
  const wantsApprove = actionId === ACTIONS.approve || actionId === ACTIONS.signOff;
  const wantsReject = actionId === ACTIONS.reject;
  if ((wantsApprove || wantsReject) && recordId) {
    return { kind: 'decision', approval, decision: wantsReject ? 'reject' : 'approve', recordId, leadId };
  }

  return { kind: 'approvals', segment, highlightId: recordId };
}
