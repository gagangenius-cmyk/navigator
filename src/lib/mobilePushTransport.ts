import http2 from 'http2';
import { SignJWT, importPKCS8 } from 'jose';
import type { MobileDevice } from './mobileDevices';
import type { PushPayload } from './mobilePushContent';

// Direct delivery to Google FCM (Android) and Apple APNs (iOS) - no relay
// service in between. Both providers are authenticated with `jose` (already a
// dependency), so this adds no packages. The app side is expo-notifications,
// which builds the notification and its action buttons natively from these
// payloads - see mobile/src/services/push and:
//   Android: data-only FCM message, keys read by expo-notifications'
//            NotificationData (title, message, body, channelId, categoryId, badge, tag)
//   iOS:     aps.alert + aps.category, with the custom data under `body`
//            (expo-notifications surfaces userInfo["body"] as content.data)
//
// Configuration (all optional - a provider that isn't configured is skipped):
//   FCM_SERVICE_ACCOUNT_JSON  Firebase service-account JSON (raw or base64)
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (.p8 contents, raw or base64),
//   APNS_BUNDLE_ID, APNS_ENVIRONMENT ('production' | 'sandbox', default production)

export interface SendOutcome {
  token: string;
  ok: boolean;
  /** The provider says this token is dead; deactivate it. */
  unregistered?: boolean;
  skipped?: boolean;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 8000;
const PUSH_TTL_SECONDS = 60 * 60;

// ---------- credential parsing ------------------------------------------

function decodeMaybeBase64(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('{') || trimmed.includes('BEGIN')) return trimmed;
  try {
    return Buffer.from(trimmed, 'base64').toString('utf8');
  } catch {
    return trimmed;
  }
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedServiceAccount: ServiceAccount | null | undefined;

function getServiceAccount(): ServiceAccount | null {
  if (cachedServiceAccount !== undefined) return cachedServiceAccount;
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return (cachedServiceAccount = null);
  try {
    const parsed = JSON.parse(decodeMaybeBase64(raw)) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return (cachedServiceAccount = null);
    return (cachedServiceAccount = {
      project_id: parsed.project_id,
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    });
  } catch {
    console.error('FCM_SERVICE_ACCOUNT_JSON is set but is not valid JSON/base64 JSON.');
    return (cachedServiceAccount = null);
  }
}

interface ApnsConfig {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  defaultEnvironment: 'production' | 'sandbox';
}

function getApnsConfig(): ApnsConfig | null {
  const { APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_BUNDLE_ID, APNS_ENVIRONMENT } = process.env;
  if (!APNS_KEY_ID || !APNS_TEAM_ID || !APNS_PRIVATE_KEY || !APNS_BUNDLE_ID) return null;
  return {
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    privateKey: decodeMaybeBase64(APNS_PRIVATE_KEY).replace(/\\n/g, '\n'),
    bundleId: APNS_BUNDLE_ID,
    defaultEnvironment: APNS_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production',
  };
}

export const isAndroidPushConfigured = () => getServiceAccount() !== null;
export const isIosPushConfigured = () => getApnsConfig() !== null;

// ---------- FCM (Android) -----------------------------------------------

let fcmAccessToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(account: ServiceAccount): Promise<string> {
  if (fcmAccessToken && fcmAccessToken.expiresAt - 60_000 > Date.now()) return fcmAccessToken.token;

  const key = await importPKCS8(account.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(account.client_email)
    .setSubject(account.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Google OAuth token request failed (${response.status})`);
  const json = (await response.json()) as { access_token: string; expires_in: number };
  fcmAccessToken = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

export function buildFcmMessage(token: string, payload: PushPayload): Record<string, unknown> {
  const data: Record<string, string> = {
    title: payload.title,
    message: payload.body,
    body: JSON.stringify(payload.data),
    channelId: payload.channelId,
    categoryId: payload.category,
    tag: payload.tag,
  };
  if (payload.badge !== null) data.badge = String(payload.badge);

  return {
    message: {
      token,
      // Data-only on purpose: expo-notifications presents it natively (with
      // the action buttons of `categoryId`) even when the app is killed.
      data,
      android: { priority: 'HIGH', ttl: `${PUSH_TTL_SECONDS}s` },
    },
  };
}

export async function sendAndroidPush(device: MobileDevice, payload: PushPayload): Promise<SendOutcome> {
  const account = getServiceAccount();
  if (!account) return { token: device.push_token, ok: false, skipped: true, error: 'FCM not configured' };

  try {
    const accessToken = await getFcmAccessToken(account);
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildFcmMessage(device.push_token, payload)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return { token: device.push_token, ok: true };

    const text = await response.text();
    if (response.status === 401) fcmAccessToken = null;
    return { token: device.push_token, ok: false, unregistered: isFcmTokenDead(response.status, text), error: `FCM ${response.status}: ${text.slice(0, 300)}` };
  } catch (error) {
    return { token: device.push_token, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** UNREGISTERED (404) and a rejected registration token (400) mean the token is dead. */
export function isFcmTokenDead(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return body.includes('UNREGISTERED') || /registration token/i.test(body);
}

// ---------- APNs (iOS) --------------------------------------------------

let apnsJwt: { token: string; issuedAt: number } | null = null;

async function getApnsJwt(config: ApnsConfig): Promise<string> {
  // Apple wants a provider token refreshed at most every 20 min and at least
  // every 60 min; reuse one for 40 min.
  if (apnsJwt && Date.now() - apnsJwt.issuedAt < 40 * 60_000) return apnsJwt.token;
  const key = await importPKCS8(config.privateKey, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt()
    .sign(key);
  apnsJwt = { token, issuedAt: Date.now() };
  return token;
}

export function buildApnsPayload(payload: PushPayload): Record<string, unknown> {
  const aps: Record<string, unknown> = {
    alert: { title: payload.title, body: payload.body },
    sound: 'default',
    category: payload.category,
    'thread-id': payload.category,
  };
  if (payload.badge !== null) aps.badge = payload.badge;
  // expo-notifications reads a remote notification's data from `body`.
  return { aps, body: payload.data };
}

interface ApnsResponse {
  status: number;
  body: string;
}

function apnsPost(host: string, token: string, headers: Record<string, string>, payload: string): Promise<ApnsResponse> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('APNs request timed out'));
    }, REQUEST_TIMEOUT_MS);
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };

    client.on('error', (error) => finish(() => reject(error)));

    const request = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, ...headers });
    let status = 0;
    let body = '';
    request.setEncoding('utf8');
    request.on('response', (responseHeaders) => {
      status = Number(responseHeaders[':status']);
    });
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () =>
      finish(() => {
        client.close();
        resolve({ status, body });
      }),
    );
    request.on('error', (error) => finish(() => reject(error)));
    request.end(payload);
  });
}

export function isApnsTokenDead(status: number, body: string): boolean {
  if (status === 410) return true;
  return status === 400 && body.includes('BadDeviceToken');
}

export async function sendIosPush(device: MobileDevice, payload: PushPayload): Promise<SendOutcome> {
  const config = getApnsConfig();
  if (!config) return { token: device.push_token, ok: false, skipped: true, error: 'APNs not configured' };

  const environment = device.environment ?? config.defaultEnvironment;
  const host = environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const body = JSON.stringify(buildApnsPayload(payload));

  const attempt = async (): Promise<ApnsResponse> => {
    const jwt = await getApnsJwt(config);
    return apnsPost(host, device.push_token, {
      authorization: `bearer ${jwt}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + PUSH_TTL_SECONDS),
      'apns-collapse-id': payload.tag.slice(0, 64),
      'content-type': 'application/json',
    }, body);
  };

  try {
    let response = await attempt();
    if (response.status === 403 && response.body.includes('ExpiredProviderToken')) {
      apnsJwt = null;
      response = await attempt();
    }
    if (response.status === 200) return { token: device.push_token, ok: true };
    return {
      token: device.push_token,
      ok: false,
      unregistered: isApnsTokenDead(response.status, response.body),
      error: `APNs ${response.status}: ${response.body.slice(0, 300)}`,
    };
  } catch (error) {
    return { token: device.push_token, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
