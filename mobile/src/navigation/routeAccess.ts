import {
  canApproveDiscounts,
  canReviewCompliance,
  canSeeApprovals,
  canVerifyPayments,
  hasPermission,
} from '@/features/auth/rbac';
import type { SessionUser } from '@/features/auth/types';
import type { RouteName } from './types';

// Route-level RBAC: which routes a user may open. The tab bar, the "More" menu, the
// ProtectedScreen guard and the push router all read this one table, so a screen can
// never be reachable by deep link or notification tap when it is hidden from the menu.
//
// A rule grants access if the user holds ANY listed permission ('all' always passes)
// OR the predicate returns true. A route with no rule is open to every signed-in user.
// The server still enforces every request; this only decides what the app offers.

interface AccessRule {
  permissions?: string[];
  predicate?: (user: SessionUser) => boolean;
}

export const ROUTE_ACCESS: Partial<Record<RouteName, AccessRule>> = {
  Leads: { permissions: ['leads.view'] },
  LeadDetail: { permissions: ['leads.view'] },
  LeadForm: { permissions: ['leads.create', 'leads.update'] },
  LeadPool: { permissions: ['leads.view'] },
  FollowUps: { permissions: ['leads.view'] },
  Appointments: { permissions: ['appointments.view', 'appointments.manage', 'leads.view'] },
  Clients: { permissions: ['clients.view'] },
  Balances: { permissions: ['leads.view', 'finance.view', 'payments.view'] },

  Approvals: { predicate: canSeeApprovals },
  ConfirmDecision: { predicate: canSeeApprovals },

  Payslips: { permissions: ['hr.self', 'hr.payroll'] },
  ItTickets: { permissions: ['it.self'] },
  TeamAttendance: { permissions: ['hr.view', 'hr.reports.attendance'] },
  // Home, Notifications, More, Profile, Settings, Attendance, Leave: any signed-in user.
};

export function canAccess(route: RouteName, user: SessionUser | null | undefined): boolean {
  if (!user) return false;
  const rule = ROUTE_ACCESS[route];
  if (!rule) return true;
  if (rule.permissions && hasPermission(user, ...rule.permissions)) return true;
  if (rule.predicate && rule.predicate(user)) return true;
  return false;
}

/** Which approval inboxes the user can work, in display order. */
export function approvalSegmentsFor(user: SessionUser | null | undefined): ('discounts' | 'payments' | 'compliance')[] {
  const segments: ('discounts' | 'payments' | 'compliance')[] = [];
  if (canApproveDiscounts(user)) segments.push('discounts');
  if (canVerifyPayments(user)) segments.push('payments');
  if (canReviewCompliance(user)) segments.push('compliance');
  return segments;
}
