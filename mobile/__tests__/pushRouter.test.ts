import { canReceivePush } from '@/services/push/policy';
import { resolveNotificationRoute } from '@/services/push/router';
import { ACTIONS, DEFAULT_ACTION, parsePushData, type PushData } from '@/services/push/types';
import { accounts, ceo, counselor, otherDirector, teamLeader } from './fixtures';

const discount: PushData = { type: 'discount_requested', leadId: '99', relatedId: '99', discountApprovalId: '12', clientName: 'Jane Doe' };
const payment: PushData = { type: 'payment_submission', leadId: '99', relatedId: '99', paymentId: '7' };
const compliance: PushData = { type: 'compliance_submission', leadId: '99', relatedId: '99', complianceApprovalId: '4' };
const lead: PushData = { type: 'lead_assigned', leadId: '55', relatedId: '55', phone: '+971501234567' };

describe('parsePushData', () => {
  it('accepts the four CRM events and stringifies numbers', () => {
    expect(parsePushData({ type: 'lead_assigned', leadId: 5 })).toMatchObject({ type: 'lead_assigned', leadId: '5' });
    for (const type of ['lead_assigned', 'discount_requested', 'compliance_submission', 'payment_submission']) {
      expect(parsePushData({ type })).not.toBeNull();
    }
  });

  it('rejects anything else so a stray or forged notification is never acted on', () => {
    expect(parsePushData(null)).toBeNull();
    expect(parsePushData('lead_assigned')).toBeNull();
    expect(parsePushData({ type: 'discount_auto_approved' })).toBeNull();
    expect(parsePushData({ type: 'DROP TABLE' })).toBeNull();
    expect(parsePushData({})).toBeNull();
  });

  it('drops non-string/number values', () => {
    const parsed = parsePushData({ type: 'lead_assigned', nested: { a: 1 }, list: [1], flag: true });
    expect(parsed).toEqual({ type: 'lead_assigned' });
  });
});

describe('canReceivePush (role-aware policy)', () => {
  it('sends the CEO all three approval events', () => {
    expect(canReceivePush('discount_requested', ceo)).toBe(true);
    expect(canReceivePush('payment_submission', ceo)).toBe(true);
    expect(canReceivePush('compliance_submission', ceo)).toBe(true);
  });

  it('lets any signed-in user receive their own lead assignment', () => {
    for (const user of [ceo, counselor, teamLeader, accounts]) expect(canReceivePush('lead_assigned', user)).toBe(true);
  });

  it('drops approval pushes for a user without the role (e.g. a shared phone)', () => {
    expect(canReceivePush('discount_requested', counselor)).toBe(false);
    expect(canReceivePush('compliance_submission', counselor)).toBe(false);
    expect(canReceivePush('payment_submission', counselor)).toBe(false);
    expect(canReceivePush('discount_requested', otherDirector)).toBe(false);
  });

  it('gives Accounts the payment event only', () => {
    expect(canReceivePush('payment_submission', accounts)).toBe(true);
    expect(canReceivePush('discount_requested', accounts)).toBe(false);
    expect(canReceivePush('compliance_submission', accounts)).toBe(false);
  });

  it('drops everything when nobody is signed in', () => {
    expect(canReceivePush('lead_assigned', null)).toBe(false);
  });
});

describe('resolveNotificationRoute', () => {
  describe('CEO approvals', () => {
    it('opens the matching inbox segment, highlighting the record, on a plain tap', () => {
      expect(resolveNotificationRoute(discount, ceo, DEFAULT_ACTION)).toEqual({ kind: 'approvals', segment: 'discounts', highlightId: '12' });
      expect(resolveNotificationRoute(payment, ceo)).toEqual({ kind: 'approvals', segment: 'payments', highlightId: '7' });
      expect(resolveNotificationRoute(compliance, ceo)).toEqual({ kind: 'approvals', segment: 'compliance', highlightId: '4' });
    });

    it('routes Approve / Reject to the confirm sheet for the exact record - never straight to a decision API', () => {
      expect(resolveNotificationRoute(discount, ceo, ACTIONS.approve)).toEqual({ kind: 'decision', approval: 'discount', decision: 'approve', recordId: '12', leadId: 99 });
      expect(resolveNotificationRoute(discount, ceo, ACTIONS.reject)).toMatchObject({ kind: 'decision', decision: 'reject', recordId: '12' });
      expect(resolveNotificationRoute(payment, ceo, ACTIONS.approve)).toMatchObject({ kind: 'decision', approval: 'payment', recordId: '7' });
      expect(resolveNotificationRoute(payment, ceo, ACTIONS.reject)).toMatchObject({ kind: 'decision', approval: 'payment', decision: 'reject' });
    });

    it('treats Sign-off as an approve decision on the compliance record', () => {
      expect(resolveNotificationRoute(compliance, ceo, ACTIONS.signOff)).toEqual({ kind: 'decision', approval: 'compliance', decision: 'approve', recordId: '4', leadId: 99 });
    });

    it('falls back to the inbox instead of guessing a record when the id is missing', () => {
      const noId: PushData = { type: 'discount_requested', leadId: '99' };
      expect(resolveNotificationRoute(noId, ceo, ACTIONS.approve)).toEqual({ kind: 'approvals', segment: 'discounts', highlightId: undefined });
    });

    it('ignores an unknown action id on an approval and just opens the inbox', () => {
      expect(resolveNotificationRoute(discount, ceo, 'something_else')).toMatchObject({ kind: 'approvals', segment: 'discounts' });
    });
  });

  describe('counselor lead assignment', () => {
    it('opens the lead on tap and on View Profile', () => {
      expect(resolveNotificationRoute(lead, counselor)).toEqual({ kind: 'lead', leadId: 55 });
      expect(resolveNotificationRoute(lead, counselor, ACTIONS.viewProfile)).toEqual({ kind: 'lead', leadId: 55 });
    });

    it('carries the phone number for the Call action', () => {
      expect(resolveNotificationRoute(lead, counselor, ACTIONS.call)).toEqual({ kind: 'call', leadId: 55, phone: '+971501234567' });
    });

    it('needs a valid lead id', () => {
      expect(resolveNotificationRoute({ type: 'lead_assigned' }, counselor)).toBeNull();
      expect(resolveNotificationRoute({ type: 'lead_assigned', leadId: 'abc' }, counselor)).toBeNull();
      expect(resolveNotificationRoute({ type: 'lead_assigned', leadId: '-3' }, counselor)).toBeNull();
    });
  });

  describe('role enforcement (defence in depth)', () => {
    it('refuses to route an approval payload for a user without the role', () => {
      expect(resolveNotificationRoute(discount, counselor)).toBeNull();
      expect(resolveNotificationRoute(discount, counselor, ACTIONS.approve)).toBeNull();
      expect(resolveNotificationRoute(compliance, counselor, ACTIONS.signOff)).toBeNull();
    });

    it('routes nothing when signed out', () => {
      expect(resolveNotificationRoute(lead, null)).toBeNull();
      expect(resolveNotificationRoute(discount, undefined, ACTIONS.approve)).toBeNull();
    });

    it('lets a team leader work discounts and compliance but not Accounts payments', () => {
      expect(resolveNotificationRoute(discount, teamLeader)).not.toBeNull();
      expect(resolveNotificationRoute(compliance, teamLeader)).not.toBeNull();
      expect(resolveNotificationRoute(payment, teamLeader)).toBeNull();
    });
  });
});
