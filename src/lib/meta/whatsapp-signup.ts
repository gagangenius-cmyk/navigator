/**
 * WhatsApp Embedded Signup (coexistence) - server side.
 *
 * The browser runs Meta's Embedded Signup with the "WhatsApp Business app
 * onboarding" feature type, which connects a number that is still used in the
 * WhatsApp Business app to the Cloud API WITHOUT removing it from the app. Meta
 * hands the browser a short-lived `code` plus the WABA id; this module turns
 * that into a working webhook subscription:
 *
 *   code -> business token (used transiently, never stored or logged)
 *        -> subscribe our app to the WABA, so Meta forwards its messages
 *           (incl. Click-to-WhatsApp `referral` data) to /api/webhooks/whatsapp
 *        -> read back the number's status so the admin can see it worked
 *
 * Receiving needs no stored token: the app-level webhook is already configured
 * and the WABA subscription is what routes this number's events to it.
 */

const BASE = 'https://graph.facebook.com';
const TIMEOUT_MS = 15_000;

const ID_PATTERN = /^\d{5,32}$/;
const MAX_CODE_LENGTH = 2048;

export class SignupError extends Error {
  constructor(message: string, readonly status: number = 502) {
    super(message);
    this.name = 'SignupError';
  }
}

export interface SignupInput {
  code: string;
  wabaId: string;
  phoneNumberId?: string | null;
}

export interface SignupPhone {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string | null;
  isOnBizApp: boolean | null;
  platformType: string | null;
}

export interface SignupResult {
  wabaId: string;
  subscribed: boolean;
  phones: SignupPhone[];
  /** The number that was just onboarded, when Meta told us which one. */
  phone: SignupPhone | null;
}

function apiVersion(): string {
  return process.env.META_GRAPH_API_VERSION || 'v21.0';
}

function appCredentials(): { id: string; secret: string } {
  const id = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!id || !secret) throw new SignupError('META_APP_ID / META_APP_SECRET are not configured', 500);
  return { id, secret };
}

/** Validates browser-supplied input; the code is opaque, the ids must be numeric. */
export function parseSignupInput(body: unknown): SignupInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const code = typeof b.code === 'string' ? b.code.trim() : '';
  const wabaId = typeof b.wabaId === 'string' || typeof b.wabaId === 'number' ? String(b.wabaId).trim() : '';
  const rawPhone = b.phoneNumberId;
  const phoneNumberId = typeof rawPhone === 'string' || typeof rawPhone === 'number' ? String(rawPhone).trim() : '';

  if (!code || code.length > MAX_CODE_LENGTH) throw new SignupError('A valid signup code is required', 400);
  if (!ID_PATTERN.test(wabaId)) throw new SignupError('A valid WhatsApp Business Account id is required', 400);
  if (phoneNumberId && !ID_PATTERN.test(phoneNumberId)) throw new SignupError('Invalid phone number id', 400);

  return { code, wabaId, phoneNumberId: phoneNumberId || null };
}

async function graph<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new SignupError('Could not reach Meta - try again', 504);
  }
  const text = await res.text();
  let json: { error?: { message?: string } } & Record<string, unknown> = {};
  try { json = JSON.parse(text); } catch { /* non-JSON body handled below */ }
  if (!res.ok) {
    // Meta's own message is safe to surface; it never contains our token.
    throw new SignupError(json.error?.message || `Meta responded with ${res.status}`, res.status >= 500 ? 502 : 400);
  }
  return json as T;
}

export async function exchangeSignupCode(code: string): Promise<string> {
  const { id, secret } = appCredentials();
  const params = new URLSearchParams({ client_id: id, client_secret: secret, code });
  const data = await graph<{ access_token?: string }>(`${BASE}/${apiVersion()}/oauth/access_token?${params}`);
  if (!data.access_token) throw new SignupError('Meta did not return an access token for this code', 502);
  return data.access_token;
}

export async function subscribeWaba(wabaId: string, token: string): Promise<boolean> {
  const data = await graph<{ success?: boolean }>(`${BASE}/${apiVersion()}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  return data.success === true;
}

interface RawPhone {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  status?: string;
  is_on_biz_app?: boolean;
  platform_type?: string;
}

export async function listWabaPhones(wabaId: string, token: string): Promise<SignupPhone[]> {
  const fields = 'id,display_phone_number,verified_name,status,is_on_biz_app,platform_type';
  const data = await graph<{ data?: RawPhone[] }>(
    `${BASE}/${apiVersion()}/${wabaId}/phone_numbers?fields=${fields}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return (data.data ?? []).map((p) => ({
    id: p.id,
    displayPhoneNumber: p.display_phone_number ?? null,
    verifiedName: p.verified_name ?? null,
    status: p.status ?? null,
    isOnBizApp: typeof p.is_on_biz_app === 'boolean' ? p.is_on_biz_app : null,
    platformType: p.platform_type ?? null,
  }));
}

export async function completeEmbeddedSignup(input: SignupInput): Promise<SignupResult> {
  const token = await exchangeSignupCode(input.code);
  const subscribed = await subscribeWaba(input.wabaId, token);
  if (!subscribed) throw new SignupError('Meta did not confirm the webhook subscription for this WhatsApp account', 502);

  const phones = await listWabaPhones(input.wabaId, token);
  const phone = input.phoneNumberId ? phones.find((p) => p.id === input.phoneNumberId) ?? null : null;
  return { wabaId: input.wabaId, subscribed, phones, phone };
}
