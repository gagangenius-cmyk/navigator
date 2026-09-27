import type { ApprovalKind } from '@/services/push/router';

// Pure rules for the approve / reject flow, kept free of API and UI imports so they
// can be unit tested. The screen and the dispatcher both read from here.

export type Decision = 'approve' | 'reject';

export interface DecisionLabels {
  /** Button / heading verb: "Approve", "Sign off", "Reject". */
  verb: string;
  /** Sheet title, e.g. "Approve discount". */
  title: string;
  /** Toast after success, e.g. "Discount approved". */
  done: string;
}

const NOUN: Record<ApprovalKind, string> = {
  discount: 'discount',
  payment: 'payment',
  compliance: 'agreement',
};

export function decisionLabels(approval: ApprovalKind, decision: Decision): DecisionLabels {
  const noun = NOUN[approval];
  if (decision === 'reject') return { verb: 'Reject', title: `Reject ${noun}`, done: `${capitalise(noun)} rejected` };
  if (approval === 'compliance') return { verb: 'Sign off', title: 'Sign off agreement', done: 'Agreement signed off' };
  if (approval === 'payment') return { verb: 'Approve', title: 'Approve payment', done: 'Payment approved' };
  return { verb: 'Approve', title: 'Approve discount', done: 'Discount approved' };
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const MIN_NOTE_LENGTH = 3;

/**
 * Rejecting a payment or an agreement sends it back to the counselor, so the reviewer
 * must say why. (The discount endpoint has nowhere to store a reason, so none is asked.)
 */
export function requiresNote(approval: ApprovalKind, decision: Decision): boolean {
  return decision === 'reject' && (approval === 'payment' || approval === 'compliance');
}

export function validateNote(approval: ApprovalKind, decision: Decision, note: string): string | null {
  if (!requiresNote(approval, decision)) return null;
  return note.trim().length >= MIN_NOTE_LENGTH ? null : 'Add a short reason so the counselor knows what to fix.';
}

/** The user-facing status filters on the approvals lists. */
export type StatusFilter = 'pending' | 'approved' | 'rejected';
