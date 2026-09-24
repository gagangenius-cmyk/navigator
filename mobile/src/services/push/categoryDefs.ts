import { ACTIONS, type ActionId, type PushCategory } from './types';

// The action buttons that appear on each kind of notification. The category ids
// match what the server sets (`categoryId` in the Android data payload,
// `aps.category` on iOS).
//
// Every button opens the app rather than acting from the lock screen: approvals
// move real money, so Approve / Reject / Sign-off land on an in-app confirm
// sheet that requires biometrics (features/approvals ConfirmDecisionScreen), and
// on iOS the device must additionally be unlocked to press them.

export interface ActionDef {
  identifier: ActionId;
  buttonTitle: string;
  destructive?: boolean;
  /** iOS: require the device to be unlocked before the action can fire. */
  requiresUnlock?: boolean;
}

export const CATEGORY_ACTIONS: Record<PushCategory, ActionDef[]> = {
  DISCOUNT_APPROVAL: [
    { identifier: ACTIONS.approve, buttonTitle: 'Approve', requiresUnlock: true },
    { identifier: ACTIONS.reject, buttonTitle: 'Reject', destructive: true, requiresUnlock: true },
  ],
  ACCOUNT_APPROVAL: [
    { identifier: ACTIONS.approve, buttonTitle: 'Approve', requiresUnlock: true },
    { identifier: ACTIONS.reject, buttonTitle: 'Reject', destructive: true, requiresUnlock: true },
  ],
  COMPLIANCE_APPROVAL: [{ identifier: ACTIONS.signOff, buttonTitle: 'Sign-off', requiresUnlock: true }],
  LEAD_ASSIGNED: [
    { identifier: ACTIONS.call, buttonTitle: 'Call' },
    { identifier: ACTIONS.viewProfile, buttonTitle: 'View Profile' },
  ],
};

/** Categories a user needs registered, by what they can act on. */
export function categoriesForUser(flags: { approvals: boolean }): PushCategory[] {
  const categories: PushCategory[] = ['LEAD_ASSIGNED'];
  if (flags.approvals) categories.push('DISCOUNT_APPROVAL', 'ACCOUNT_APPROVAL', 'COMPLIANCE_APPROVAL');
  return categories;
}
