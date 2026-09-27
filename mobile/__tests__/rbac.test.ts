import {
  canApproveDiscounts,
  canReviewCompliance,
  canSeeApprovals,
  canVerifyPayments,
  hasPermission,
  homeVariant,
  isBranchManagerOrCeo,
  isCeo,
  isCounsellor,
} from '@/features/auth/rbac';
import { accounts, ceo, counselor, hr, otherDirector, teamLeader } from './fixtures';

describe('isCeo', () => {
  it('identifies the CEO by role name', () => {
    expect(isCeo(ceo)).toBe(true);
    expect(isCeo({ roleName: ' ceo ', type: 'director' })).toBe(true);
  });

  it('does not treat other director-type roles as the CEO', () => {
    expect(otherDirector.type).toBe('director');
    expect(isCeo(otherDirector)).toBe(false);
  });

  it('is false for nobody / other roles', () => {
    expect(isCeo(null)).toBe(false);
    expect(isCeo(counselor)).toBe(false);
  });
});

describe('hasPermission', () => {
  it("'all' passes everything", () => {
    expect(hasPermission(ceo, 'anything.at.all')).toBe(true);
  });

  it('passes on any one listed key', () => {
    expect(hasPermission(counselor, 'nope', 'leads.create')).toBe(true);
    expect(hasPermission(counselor, 'finance.view')).toBe(false);
  });

  it('is false with no user', () => {
    expect(hasPermission(null, 'leads.view')).toBe(false);
  });
});

describe('approval capabilities', () => {
  it('lets the CEO and the manager tier approve discounts and review compliance', () => {
    for (const user of [ceo, teamLeader]) {
      expect(canApproveDiscounts(user)).toBe(true);
      expect(canReviewCompliance(user)).toBe(true);
      expect(isBranchManagerOrCeo(user)).toBe(true);
    }
  });

  it('keeps counselors, HR and Accounts out of discount and compliance approval', () => {
    for (const user of [counselor, hr, accounts]) {
      expect(canApproveDiscounts(user)).toBe(false);
      expect(canReviewCompliance(user)).toBe(false);
    }
  });

  it('lets finance users (and the CEO) verify payments', () => {
    expect(canVerifyPayments(accounts)).toBe(true);
    expect(canVerifyPayments(ceo)).toBe(true);
    expect(canVerifyPayments(counselor)).toBe(false);
  });

  it('shows the Approvals tab only to people who can act on something', () => {
    expect(canSeeApprovals(ceo)).toBe(true);
    expect(canSeeApprovals(teamLeader)).toBe(true);
    expect(canSeeApprovals(accounts)).toBe(true);
    expect(canSeeApprovals(counselor)).toBe(false);
    expect(canSeeApprovals(hr)).toBe(false);
  });
});

describe('isCounsellor / homeVariant', () => {
  it('recognises advisors as counselors', () => {
    expect(isCounsellor(counselor)).toBe(true);
    expect(isCounsellor(ceo)).toBe(false);
  });

  it('picks the right dashboard layout per role', () => {
    expect(homeVariant(ceo)).toBe('executive');
    expect(homeVariant(teamLeader)).toBe('manager');
    expect(homeVariant(counselor)).toBe('counselor');
    expect(homeVariant(hr)).toBe('general');
    expect(homeVariant(null)).toBe('general');
  });
});
