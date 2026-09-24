import { approvalSegmentsFor, canAccess } from '@/navigation/routeAccess';
import { accounts, ceo, counselor, hr, teamLeader } from './fixtures';

describe('canAccess (route-level RBAC)', () => {
  it('lets the CEO into everything gated', () => {
    for (const route of ['Leads', 'Approvals', 'ConfirmDecision', 'Payslips', 'ItTickets', 'Clients', 'Balances'] as const) {
      expect(canAccess(route, ceo)).toBe(true);
    }
  });

  it('shows counselors leads but not approvals', () => {
    expect(canAccess('Leads', counselor)).toBe(true);
    expect(canAccess('LeadForm', counselor)).toBe(true);
    expect(canAccess('Approvals', counselor)).toBe(false);
    expect(canAccess('ConfirmDecision', counselor)).toBe(false);
  });

  it('keeps leads away from roles without leads.view', () => {
    expect(canAccess('Leads', accounts)).toBe(false);
    expect(canAccess('LeadDetail', hr)).toBe(false);
  });

  it('gives Accounts the approvals inbox via finance permissions', () => {
    expect(canAccess('Approvals', accounts)).toBe(true);
  });

  it('leaves un-gated routes (home, notifications, settings...) open to any signed-in user', () => {
    for (const route of ['Home', 'Notifications', 'More', 'Profile', 'Settings', 'Attendance', 'Leave'] as const) {
      expect(canAccess(route, hr)).toBe(true);
    }
  });

  it('denies everything when signed out', () => {
    expect(canAccess('Home', null)).toBe(false);
    expect(canAccess('Leads', undefined)).toBe(false);
  });

  it('gates HR self-service and IT by their own permissions', () => {
    expect(canAccess('Payslips', counselor)).toBe(true); // hr.self
    expect(canAccess('Payslips', teamLeader)).toBe(false);
    expect(canAccess('ItTickets', counselor)).toBe(true);
    expect(canAccess('ItTickets', teamLeader)).toBe(false);
  });
});

describe('approvalSegmentsFor', () => {
  it('gives the CEO all three inboxes', () => {
    expect(approvalSegmentsFor(ceo)).toEqual(['discounts', 'payments', 'compliance']);
  });
  it('gives Accounts only payments, and a team leader discounts + compliance', () => {
    expect(approvalSegmentsFor(accounts)).toEqual(['payments']);
    expect(approvalSegmentsFor(teamLeader)).toEqual(['discounts', 'compliance']);
  });
  it('gives counselors nothing', () => {
    expect(approvalSegmentsFor(counselor)).toEqual([]);
    expect(approvalSegmentsFor(null)).toEqual([]);
  });
});
