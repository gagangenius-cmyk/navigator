import { describe, expect, it } from 'vitest';
import {
  MAX_DATA_BYTES,
  PUSH_TYPES,
  buildPushPayload,
  categoryFor,
  channelFor,
  cleanFacts,
  isPushEligible,
  type PushFacts,
  type PushSource,
} from '../../src/lib/mobilePushContent';
import { buildApnsPayload, buildFcmMessage, isApnsTokenDead, isFcmTokenDead } from '../../src/lib/mobilePushTransport';

const source = (overrides: Partial<PushSource> = {}): PushSource => ({
  id: 42,
  user_id: 7,
  type: 'discount_requested',
  title: 'Discount approval requested',
  message: 'A 500 AED discount was requested for Jane Doe.',
  related_id: 99,
  related_type: 'lead',
  ...overrides,
});

const discountFacts: PushFacts = {
  ids: { leadId: '99', discountApprovalId: '12' },
  display: { clientName: 'Jane Doe', discountAmount: '500', discountPercent: '12.5', currency: 'AED', requestedBy: 'Harpreet' },
};

describe('isPushEligible', () => {
  it('accepts exactly the four mobile events', () => {
    for (const type of PUSH_TYPES) expect(isPushEligible(type)).toBe(true);
    expect(PUSH_TYPES).toHaveLength(4);
  });

  it('rejects everything else, including informational discount notices', () => {
    for (const type of ['discount_auto_approved', 'discount_reviewed', 'compliance_review', 'payment_verification', 'system', '', undefined, null, 5]) {
      expect(isPushEligible(type)).toBe(false);
    }
  });
});

describe('categoryFor / channelFor', () => {
  it('maps each event to its action-button category', () => {
    expect(categoryFor('lead_assigned')).toBe('LEAD_ASSIGNED');
    expect(categoryFor('discount_requested')).toBe('DISCOUNT_APPROVAL');
    expect(categoryFor('payment_submission')).toBe('ACCOUNT_APPROVAL');
    expect(categoryFor('compliance_submission')).toBe('COMPLIANCE_APPROVAL');
  });

  it('routes leads and approvals to their Android channels', () => {
    expect(channelFor('lead_assigned')).toBe('leads');
    expect(channelFor('discount_requested')).toBe('approvals');
    expect(channelFor('payment_submission')).toBe('approvals');
    expect(channelFor('compliance_submission')).toBe('approvals');
  });
});

describe('cleanFacts', () => {
  it('stringifies values and drops null, undefined and blank ones', () => {
    expect(cleanFacts({ a: 1, b: null, c: undefined, d: '  ', e: ' x ', f: 0 })).toEqual({ a: '1', e: 'x', f: '0' });
  });

  it('truncates very long values', () => {
    expect(cleanFacts({ note: 'x'.repeat(1000) }).note).toHaveLength(300);
  });
});

describe('buildPushPayload', () => {
  it('carries routing fields, record ids and display facts as strings', () => {
    const payload = buildPushPayload(source(), 'discount_requested', discountFacts, { redact: false, badge: 3 });

    expect(payload.title).toBe('Discount approval requested');
    expect(payload.body).toContain('Jane Doe');
    expect(payload.category).toBe('DISCOUNT_APPROVAL');
    expect(payload.channelId).toBe('approvals');
    expect(payload.tag).toBe('n-42');
    expect(payload.badge).toBe(3);
    expect(payload.data).toMatchObject({
      type: 'discount_requested',
      notificationId: '42',
      category: 'DISCOUNT_APPROVAL',
      relatedType: 'lead',
      relatedId: '99',
      leadId: '99',
      discountApprovalId: '12',
      clientName: 'Jane Doe',
      discountPercent: '12.5',
    });
    for (const value of Object.values(payload.data)) expect(typeof value).toBe('string');
  });

  it('redacts lock-screen text and personal facts but keeps the ids the app needs', () => {
    const payload = buildPushPayload(source(), 'discount_requested', discountFacts, { redact: true, badge: null });

    expect(payload.title).toBe('Discount approval requested');
    expect(payload.body).not.toContain('Jane');
    expect(JSON.stringify(payload)).not.toContain('Jane Doe');
    expect(JSON.stringify(payload)).not.toContain('Harpreet');
    expect(payload.data.discountApprovalId).toBe('12');
    expect(payload.data.leadId).toBe('99');
    expect(payload.data.clientName).toBeUndefined();
    expect(payload.badge).toBeNull();
  });

  it('sheds the largest display fields first when the payload is too big, never the ids', () => {
    const facts: PushFacts = {
      ids: { leadId: '99', paymentId: '5' },
      display: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`field${i}`, 'y'.repeat(299)])),
    };
    const payload = buildPushPayload(source({ type: 'payment_submission' }), 'payment_submission', facts, { redact: false, badge: null });

    expect(Buffer.byteLength(JSON.stringify(payload.data))).toBeLessThanOrEqual(MAX_DATA_BYTES);
    expect(payload.data.paymentId).toBe('5');
    expect(payload.data.leadId).toBe('99');
    expect(payload.data.type).toBe('payment_submission');
  });

  it('works with no facts at all (lookup failed or record already actioned)', () => {
    const payload = buildPushPayload(source({ type: 'lead_assigned', title: 'New lead assigned to you' }), 'lead_assigned', { ids: {}, display: {} }, { redact: false, badge: 0 });
    expect(payload.category).toBe('LEAD_ASSIGNED');
    expect(payload.channelId).toBe('leads');
    expect(payload.data.relatedId).toBe('99');
    expect(payload.badge).toBe(0);
  });
});

describe('buildFcmMessage (Android)', () => {
  const payload = buildPushPayload(source(), 'discount_requested', discountFacts, { redact: false, badge: 2 });
  const { message } = buildFcmMessage('fcm-token', payload) as { message: Record<string, any> };

  it('is data-only so expo-notifications presents it natively, even when the app is killed', () => {
    expect(message.token).toBe('fcm-token');
    expect(message.notification).toBeUndefined();
    expect(message.android).toMatchObject({ priority: 'HIGH' });
  });

  it('uses the keys expo-notifications reads from a remote message', () => {
    expect(message.data).toMatchObject({
      title: 'Discount approval requested',
      channelId: 'approvals',
      categoryId: 'DISCOUNT_APPROVAL',
      tag: 'n-42',
      badge: '2',
    });
    expect(message.data.message).toContain('Jane Doe');
    expect(JSON.parse(message.data.body)).toMatchObject({ type: 'discount_requested', discountApprovalId: '12' });
    for (const value of Object.values(message.data)) expect(typeof value).toBe('string');
  });

  it('omits the badge when unknown', () => {
    const noBadge = buildPushPayload(source(), 'discount_requested', discountFacts, { redact: false, badge: null });
    const built = buildFcmMessage('t', noBadge) as { message: { data: Record<string, string> } };
    expect(built.message.data.badge).toBeUndefined();
  });
});

describe('buildApnsPayload (iOS)', () => {
  const payload = buildPushPayload(source({ type: 'compliance_submission', title: 'Compliance submitted' }), 'compliance_submission', { ids: { leadId: '99', complianceApprovalId: '4' }, display: {} }, { redact: false, badge: 1 });
  const built = buildApnsPayload(payload) as { aps: Record<string, any>; body: Record<string, string> };

  it('sets the alert, sound, badge and the category that shows the action buttons', () => {
    expect(built.aps.alert).toEqual({ title: 'Compliance submitted', body: expect.any(String) });
    expect(built.aps.sound).toBe('default');
    expect(built.aps.category).toBe('COMPLIANCE_APPROVAL');
    expect(built.aps.badge).toBe(1);
  });

  it('puts custom data under `body`, where expo-notifications reads a remote notification\'s data', () => {
    expect(built.body).toMatchObject({ type: 'compliance_submission', complianceApprovalId: '4', leadId: '99' });
  });
});

describe('provider dead-token detection', () => {
  it('treats FCM UNREGISTERED / rejected registration tokens as dead', () => {
    expect(isFcmTokenDead(404, '{"error":{"status":"NOT_FOUND"}}')).toBe(true);
    expect(isFcmTokenDead(400, '{"error":{"message":"The registration token is not a valid FCM registration token"}}')).toBe(true);
    expect(isFcmTokenDead(400, '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}')).toBe(true);
  });

  it('does not deactivate a device for payload or quota errors', () => {
    expect(isFcmTokenDead(400, '{"error":{"message":"Invalid JSON payload received"}}')).toBe(false);
    expect(isFcmTokenDead(429, 'quota')).toBe(false);
    expect(isFcmTokenDead(500, 'internal')).toBe(false);
  });

  it('treats APNs 410 and BadDeviceToken as dead, but not auth or payload errors', () => {
    expect(isApnsTokenDead(410, '{"reason":"Unregistered"}')).toBe(true);
    expect(isApnsTokenDead(400, '{"reason":"BadDeviceToken"}')).toBe(true);
    expect(isApnsTokenDead(400, '{"reason":"PayloadTooLarge"}')).toBe(false);
    expect(isApnsTokenDead(403, '{"reason":"ExpiredProviderToken"}')).toBe(false);
  });
});
