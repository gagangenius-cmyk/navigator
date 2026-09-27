import {
  canApproveDiscounts,
  canReviewCompliance,
  canVerifyPayments,
  isCeo,
} from '@/features/auth/rbac';
import type { SessionUser } from '@/features/auth/types';
import type { PushType } from './types';

// Role-aware filtering on the device. The server already sends each push to a
// specific employee, but a phone can be handed over or shared, and a payload can
// outlive the session that received it - so the app also checks that the
// *currently signed-in* user is someone who is meant to see and act on it. A
// payload for a role the user does not hold is dropped (foreground) or ignored
// (tap), never shown or routed.
export function canReceivePush(type: PushType, user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  switch (type) {
    case 'lead_assigned':
      // Sent to the new owner of the lead, whatever their role.
      return true;
    case 'discount_requested':
      return canApproveDiscounts(user);
    case 'compliance_submission':
      return canReviewCompliance(user);
    case 'payment_submission':
      // The CEO oversees Accounts approvals; Accounts staff verify payments.
      return isCeo(user) || canVerifyPayments(user);
  }
}
