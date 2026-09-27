import { EventEmitter } from 'node:events';
import { exportPKCS8, generateKeyPair, jwtVerify, decodeProtectedHeader } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// http2 is replaced with a scriptable fake so the APNs request can be inspected.
const apnsCalls: { host: string; headers: Record<string, string>; body: string }[] = [];
let apnsResponses: { status: number; body: string }[] = [];

vi.mock('http2', () => {
  const connect = (url: string) => {
    const client: any = new EventEmitter();
    client.destroy = () => undefined;
    client.close = () => undefined;
    client.request = (headers: Record<string, string>) => {
      const stream: any = new EventEmitter();
      stream.setEncoding = () => undefined;
      stream.end = (body: string) => {
        apnsCalls.push({ host: new URL(url).host, headers, body });
        const next = apnsResponses.shift() ?? { status: 200, body: '' };
        setImmediate(() => {
          stream.emit('response', { ':status': next.status });
          if (next.body) stream.emit('data', next.body);
          stream.emit('end');
        });
      };
      return stream;
    };
    return client;
  };
  return { default: { connect }, connect };
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

let rsa: { publicKey: CryptoKey; pem: string };
let ec: { publicKey: CryptoKey; pem: string };

beforeAll(async () => {
  const rsaPair = await generateKeyPair('RS256', { extractable: true });
  rsa = { publicKey: rsaPair.publicKey, pem: await exportPKCS8(rsaPair.privateKey) };
  const ecPair = await generateKeyPair('ES256', { extractable: true });
  ec = { publicKey: ecPair.publicKey, pem: await exportPKCS8(ecPair.privateKey) };
});

const payload = {
  title: 'Discount approval requested',
  body: 'A 500 AED discount was requested for Jane Doe.',
  data: { type: 'discount_requested', leadId: '99', discountApprovalId: '12' },
  category: 'DISCOUNT_APPROVAL' as const,
  channelId: 'approvals' as const,
  tag: 'n-42',
  badge: 3,
};

// Each test loads a fresh copy of the module: it caches parsed credentials and tokens.
async function loadTransport() {
  vi.resetModules();
  return import('../../src/lib/mobilePushTransport');
}

beforeEach(() => {
  apnsCalls.length = 0;
  apnsResponses = [];
  fetchMock.mockReset();
});

afterEach(() => {
  delete process.env.FCM_SERVICE_ACCOUNT_JSON;
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_TEAM_ID;
  delete process.env.APNS_PRIVATE_KEY;
  delete process.env.APNS_BUNDLE_ID;
  delete process.env.APNS_ENVIRONMENT;
});

const fcmAccount = () => ({ project_id: 'crm-test', client_email: 'push@crm-test.iam.gserviceaccount.com', private_key: rsa.pem });
const androidDevice = { push_token: 'f'.repeat(120), platform: 'android' as const, environment: null };
const iosDevice = (environment: 'sandbox' | 'production' | null = null) => ({ push_token: 'a'.repeat(64), platform: 'ios' as const, environment });

describe('providers are optional', () => {
  it('skips (does not fail) when FCM or APNs are not configured', async () => {
    const transport = await loadTransport();
    expect(transport.isAndroidPushConfigured()).toBe(false);
    expect(transport.isIosPushConfigured()).toBe(false);
    expect(await transport.sendAndroidPush(androidDevice, payload)).toMatchObject({ ok: false, skipped: true });
    expect(await transport.sendIosPush(iosDevice(), payload)).toMatchObject({ ok: false, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('FCM (Android)', () => {
  it('accepts the service account as raw JSON or base64', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = Buffer.from(JSON.stringify(fcmAccount())).toString('base64');
    expect((await loadTransport()).isAndroidPushConfigured()).toBe(true);
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(fcmAccount());
    expect((await loadTransport()).isAndroidPushConfigured()).toBe(true);
    process.env.FCM_SERVICE_ACCOUNT_JSON = '{not json';
    expect((await loadTransport()).isAndroidPushConfigured()).toBe(false);
  });

  it('signs a valid OAuth assertion, then posts a data-only message to the project endpoint', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(fcmAccount());
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'oauth-token', expires_in: 3600 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '{}' });

    const { sendAndroidPush } = await loadTransport();
    const outcome = await sendAndroidPush(androidDevice, payload);

    expect(outcome).toEqual({ token: androidDevice.push_token, ok: true });

    // 1) token exchange: a real RS256 JWT bearer assertion that verifies against the public key
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const form = new URLSearchParams(String(tokenInit.body));
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const { payload: claims } = await jwtVerify(form.get('assertion')!, rsa.publicKey, { audience: 'https://oauth2.googleapis.com/token' });
    expect(claims.iss).toBe('push@crm-test.iam.gserviceaccount.com');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');

    // 2) the send: bearer token, per-project v1 endpoint, data-only high-priority message
    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe('https://fcm.googleapis.com/v1/projects/crm-test/messages:send');
    expect(sendInit.headers.Authorization).toBe('Bearer oauth-token');
    const body = JSON.parse(sendInit.body);
    expect(body.message.token).toBe(androidDevice.push_token);
    expect(body.message.notification).toBeUndefined();
    expect(body.message.android.priority).toBe('HIGH');
    expect(body.message.data).toMatchObject({ title: payload.title, channelId: 'approvals', categoryId: 'DISCOUNT_APPROVAL', badge: '3' });
  });

  it('reuses the cached OAuth token for later sends', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(fcmAccount());
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'oauth-token', expires_in: 3600 }) })
      .mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const { sendAndroidPush } = await loadTransport();
    await sendAndroidPush(androidDevice, payload);
    await sendAndroidPush(androidDevice, payload);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('oauth2.googleapis.com'))).toHaveLength(1);
  });

  it('flags an unregistered token so it gets deactivated, but not a transient failure', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(fcmAccount());
    const oauth = { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }) };
    fetchMock
      .mockResolvedValueOnce(oauth)
      .mockResolvedValueOnce({ ok: false, status: 404, text: async () => '{"error":{"status":"NOT_FOUND"}}' })
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'unavailable' });
    const { sendAndroidPush } = await loadTransport();
    expect(await sendAndroidPush(androidDevice, payload)).toMatchObject({ ok: false, unregistered: true });
    expect(await sendAndroidPush(androidDevice, payload)).toMatchObject({ ok: false, unregistered: false });
  });

  it('reports a network failure instead of throwing', async () => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(fcmAccount());
    fetchMock.mockRejectedValue(new Error('socket hang up'));
    const { sendAndroidPush } = await loadTransport();
    expect(await sendAndroidPush(androidDevice, payload)).toMatchObject({ ok: false, error: 'socket hang up' });
  });
});

describe('APNs (iOS)', () => {
  const configure = async (extra: Record<string, string> = {}) => {
    process.env.APNS_KEY_ID = 'ABC123DEFG';
    process.env.APNS_TEAM_ID = 'TEAM123456';
    process.env.APNS_PRIVATE_KEY = ec.pem;
    process.env.APNS_BUNDLE_ID = 'com.globalnavigator.crm';
    Object.assign(process.env, extra);
    return loadTransport();
  };

  it('sends an alert with the category and custom data under `body`, authenticated with a valid ES256 provider token', async () => {
    const { sendIosPush } = await configure();
    const outcome = await sendIosPush(iosDevice('production'), payload);

    expect(outcome).toEqual({ token: 'a'.repeat(64), ok: true });
    const call = apnsCalls[0];
    expect(call.host).toBe('api.push.apple.com');
    expect(call.headers[':path']).toBe(`/3/device/${'a'.repeat(64)}`);
    expect(call.headers[':method']).toBe('POST');
    expect(call.headers['apns-topic']).toBe('com.globalnavigator.crm');
    expect(call.headers['apns-push-type']).toBe('alert');
    expect(call.headers['apns-priority']).toBe('10');

    const jwt = call.headers.authorization.replace(/^bearer /, '');
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'ES256', kid: 'ABC123DEFG' });
    const { payload: claims } = await jwtVerify(jwt, ec.publicKey);
    expect(claims.iss).toBe('TEAM123456');

    const body = JSON.parse(call.body);
    expect(body.aps.alert).toEqual({ title: payload.title, body: payload.body });
    expect(body.aps.category).toBe('DISCOUNT_APPROVAL');
    expect(body.aps.badge).toBe(3);
    expect(body.body).toEqual(payload.data);
  });

  it('accepts the .p8 key as base64 too', async () => {
    const { sendIosPush } = await configure({ APNS_PRIVATE_KEY: Buffer.from(ec.pem).toString('base64') });
    expect((await sendIosPush(iosDevice('production'), payload)).ok).toBe(true);
  });

  it('routes development-build tokens to the sandbox endpoint and falls back to APNS_ENVIRONMENT', async () => {
    const { sendIosPush } = await configure({ APNS_ENVIRONMENT: 'sandbox' });
    await sendIosPush(iosDevice('sandbox'), payload);
    await sendIosPush(iosDevice(null), payload);
    expect(apnsCalls.map((c) => c.host)).toEqual(['api.sandbox.push.apple.com', 'api.sandbox.push.apple.com']);
  });

  it('uses the production endpoint by default', async () => {
    const { sendIosPush } = await configure();
    await sendIosPush(iosDevice(null), payload);
    expect(apnsCalls[0].host).toBe('api.push.apple.com');
  });

  it('deactivates a token APNs reports as gone, but not on other errors', async () => {
    const { sendIosPush } = await configure();
    apnsResponses = [
      { status: 410, body: '{"reason":"Unregistered"}' },
      { status: 400, body: '{"reason":"BadDeviceToken"}' },
      { status: 400, body: '{"reason":"PayloadTooLarge"}' },
    ];
    expect(await sendIosPush(iosDevice(), payload)).toMatchObject({ ok: false, unregistered: true });
    expect(await sendIosPush(iosDevice(), payload)).toMatchObject({ ok: false, unregistered: true });
    expect(await sendIosPush(iosDevice(), payload)).toMatchObject({ ok: false, unregistered: false });
  });

  it('regenerates the provider token and retries once when APNs says it expired', async () => {
    const { sendIosPush } = await configure();
    apnsResponses = [{ status: 403, body: '{"reason":"ExpiredProviderToken"}' }, { status: 200, body: '' }];
    expect(await sendIosPush(iosDevice(), payload)).toMatchObject({ ok: true });
    expect(apnsCalls).toHaveLength(2);
  });
});
