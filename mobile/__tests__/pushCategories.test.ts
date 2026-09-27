import { CATEGORY_ACTIONS, categoriesForUser } from '@/services/push/categoryDefs';
import { ACTIONS, PUSH_CATEGORIES, PUSH_TYPES } from '@/services/push/types';

// These strings are a contract with the backend (src/lib/mobilePushContent.ts): the server
// puts a category id in each payload, and the button set registered here is what appears.
describe('notification action buttons', () => {
  it('defines a button set for every category the server can send', () => {
    for (const category of PUSH_CATEGORIES) expect(CATEGORY_ACTIONS[category]?.length).toBeGreaterThan(0);
  });

  it('gives each event the buttons the product asked for', () => {
    expect(CATEGORY_ACTIONS.DISCOUNT_APPROVAL.map((a) => a.buttonTitle)).toEqual(['Approve', 'Reject']);
    expect(CATEGORY_ACTIONS.ACCOUNT_APPROVAL.map((a) => a.buttonTitle)).toEqual(['Approve', 'Reject']);
    expect(CATEGORY_ACTIONS.COMPLIANCE_APPROVAL.map((a) => a.buttonTitle)).toEqual(['Sign-off']);
    expect(CATEGORY_ACTIONS.LEAD_ASSIGNED.map((a) => a.buttonTitle)).toEqual(['Call', 'View Profile']);
  });

  it('uses the action ids the router understands', () => {
    expect(CATEGORY_ACTIONS.DISCOUNT_APPROVAL.map((a) => a.identifier)).toEqual([ACTIONS.approve, ACTIONS.reject]);
    expect(CATEGORY_ACTIONS.COMPLIANCE_APPROVAL[0].identifier).toBe(ACTIONS.signOff);
    expect(CATEGORY_ACTIONS.LEAD_ASSIGNED.map((a) => a.identifier)).toEqual([ACTIONS.call, ACTIONS.viewProfile]);
  });

  it('marks Reject as destructive and requires the device to be unlocked for every approval action', () => {
    expect(CATEGORY_ACTIONS.DISCOUNT_APPROVAL.find((a) => a.identifier === ACTIONS.reject)?.destructive).toBe(true);
    for (const category of ['DISCOUNT_APPROVAL', 'ACCOUNT_APPROVAL', 'COMPLIANCE_APPROVAL'] as const) {
      for (const action of CATEGORY_ACTIONS[category]) expect(action.requiresUnlock).toBe(true);
    }
  });

  it('is role-aware: counselors only register the lead buttons, approvers all four sets', () => {
    expect(categoriesForUser({ approvals: false })).toEqual(['LEAD_ASSIGNED']);
    expect(categoriesForUser({ approvals: true }).sort()).toEqual([...PUSH_CATEGORIES].sort());
  });

  it('covers all four push types', () => {
    expect(PUSH_TYPES).toHaveLength(4);
    expect(PUSH_CATEGORIES).toHaveLength(4);
  });
});
