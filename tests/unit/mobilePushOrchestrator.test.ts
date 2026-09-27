import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const getActiveMobileDevices = vi.fn();
const deactivateMobileDevices = vi.fn();
const sendAndroidPush = vi.fn();
const sendIosPush = vi.fn();

vi.mock('../../src/lib/sequelize', () => ({ sequelize: { query: (...args: unknown[]) => query(...args) } }));
vi.mock('../../src/lib/mobileDevices', () => ({
  getActiveMobileDevices: (...args: unknown[]) => getActiveMobileDevices(...args),
  deactivateMobileDevices: (...args: unknown[]) => deactivateMobileDevices(...args),
}));
vi.mock('../../src/lib/mobilePushTransport', () => ({
  sendAndroidPush: (...args: unknown[]) => sendAndroidPush(...args),
  sendIosPush: (...args: unknown[]) => sendIosPush(...args),
}));

import { sendMobilePush } from '../../src/lib/mobilePush';

const source = (overrides = {}) => ({
  id: 42,
  user_id: 7,
  type: 'lead_assigned',
  title: 'New lead assigned to you',
  message: 'Jane Doe has been assigned to you.',
  related_id: 99,
  related_type: 'lead',
  ...overrides,
});

const android = { push_token: 'and-token', platform: 'android', environment: null };
const ios = { push_token: 'ios-token', platform: 'ios', environment: 'production' };

const leadRow = { fname: 'Jane', lname: 'Doe', phone: '+971501234567', source: 'Meta Lead Ads' };

beforeEach(() => {
  vi.clearAllMocks();
  getActiveMobileDevices.mockResolvedValue([android, ios]);
  sendAndroidPush.mockResolvedValue({ token: 'and-token', ok: true });
  sendIosPush.mockResolvedValue({ token: 'ios-token', ok: true });
  // lead facts, then the unread count
  query.mockImplementation(async (sql: string) => (sql.includes('COUNT(*)') ? [{ total: 4 }] : [leadRow]));
});

afterEach(() => {
  delete process.env.MOBILE_PUSH_ENABLED;
  delete process.env.MOBILE_PUSH_REDACT;
});

describe('sendMobilePush', () => {
  it('ignores notification types the app does not act on, without touching the database', async () => {
    for (const type of ['system', 'discount_auto_approved', 'followup', 'discount_reviewed']) {
      await sendMobilePush(source({ type }));
    }
    expect(getActiveMobileDevices).not.toHaveBeenCalled();
    expect(sendAndroidPush).not.toHaveBeenCalled();
    expect(sendIosPush).not.toHaveBeenCalled();
  });

  it('can be switched off entirely', async () => {
    process.env.MOBILE_PUSH_ENABLED = 'false';
    await sendMobilePush(source());
    expect(getActiveMobileDevices).not.toHaveBeenCalled();
  });

  it('does nothing for a user with no registered device', async () => {
    getActiveMobileDevices.mockResolvedValue([]);
    await sendMobilePush(source());
    expect(query).not.toHaveBeenCalled();
    expect(sendAndroidPush).not.toHaveBeenCalled();
  });

  it("looks up the recipient's own devices and sends each one through its own platform's provider", async () => {
    await sendMobilePush(source());

    expect(getActiveMobileDevices).toHaveBeenCalledWith(7);
    expect(sendAndroidPush).toHaveBeenCalledTimes(1);
    expect(sendIosPush).toHaveBeenCalledTimes(1);
    expect(sendAndroidPush.mock.calls[0][0]).toBe(android);
    expect(sendIosPush.mock.calls[0][0]).toBe(ios);
  });

  it('carries the real lead facts, the category, the channel and the unread badge', async () => {
    await sendMobilePush(source());
    const payload = sendAndroidPush.mock.calls[0][1];

    expect(payload).toMatchObject({ category: 'LEAD_ASSIGNED', channelId: 'leads', badge: 4, tag: 'n-42' });
    expect(payload.title).toBe('New lead assigned to you');
    expect(payload.data).toMatchObject({
      type: 'lead_assigned',
      notificationId: '42',
      leadId: '99',
      leadName: 'Jane Doe',
      phone: '+971501234567',
      source: 'Meta Lead Ads',
    });
  });

  it('shows names and phone numbers on the lock screen only when redaction is off', async () => {
    process.env.MOBILE_PUSH_REDACT = 'true';
    await sendMobilePush(source());
    const payload = sendAndroidPush.mock.calls[0][1];

    expect(payload.title).toBe('New lead assigned');
    expect(JSON.stringify(payload)).not.toContain('Jane');
    expect(JSON.stringify(payload)).not.toContain('+971501234567');
    expect(payload.data.leadId).toBe('99'); // ids still let the app open the record after auth
  });

  it('deactivates only the tokens the providers say are dead', async () => {
    sendAndroidPush.mockResolvedValue({ token: 'and-token', ok: false, unregistered: true });
    sendIosPush.mockResolvedValue({ token: 'ios-token', ok: false, unregistered: false, error: 'APNs 503' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await sendMobilePush(source());

    expect(deactivateMobileDevices).toHaveBeenCalledWith(['and-token']);
  });

  it('never throws, so a push failure cannot break the notification that triggered it', async () => {
    sendAndroidPush.mockRejectedValue(new Error('boom'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(sendMobilePush(source())).resolves.toBeUndefined();

    getActiveMobileDevices.mockRejectedValue(new Error('db down'));
    await expect(sendMobilePush(source())).resolves.toBeUndefined();
  });

  it('still sends (with ids only) when the fact lookup fails', async () => {
    query.mockRejectedValue(new Error('lookup failed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await sendMobilePush(source());
    const payload = sendAndroidPush.mock.calls[0][1];
    expect(payload.data.leadId).toBe('99');
    expect(payload.data.leadName).toBeUndefined();
  });

  it('builds the approval payloads with the exact record id for the confirm sheet', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('COUNT(*)')
        ? [{ total: 1 }]
        : [{ id: 12, discountType: 'percentage', discountAmount: 500, originalAmount: 4000, currency: 'AED', requestedBy: 'Harpreet', fname: 'Jane', lname: 'Doe' }],
    );
    await sendMobilePush(source({ type: 'discount_requested', title: 'Discount approval requested' }));
    const payload = sendAndroidPush.mock.calls[0][1];

    expect(payload).toMatchObject({ category: 'DISCOUNT_APPROVAL', channelId: 'approvals' });
    expect(payload.data).toMatchObject({ discountApprovalId: '12', discountAmount: '500', discountPercent: '12.5', currency: 'AED', requestedBy: 'Harpreet', clientName: 'Jane Doe' });
  });
});
