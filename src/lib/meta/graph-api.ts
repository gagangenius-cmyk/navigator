import type { MetaRawLead, MetaCampaign, MetaLeadForm } from './types';
import { getMetaPageAccessToken } from './token-store';

function apiVersion(): string {
  return process.env.META_GRAPH_API_VERSION || 'v21.0';
}

const BASE = 'https://graph.facebook.com';

/** Fetches a single lead record from Meta Graph API */
export async function fetchLeadFromMeta(leadgenId: string): Promise<MetaRawLead> {
  const base = ['id', 'created_time', 'ad_id', 'adset_id', 'campaign_id', 'form_id', 'field_data'];
  const token = await getMetaPageAccessToken();

  const get = (fields: string[]) => fetch(
    `${BASE}/${apiVersion()}/${leadgenId}?fields=${fields.join(',')}&access_token=${token}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000) },
  );

  // Ad/adset/campaign names come back on the lead node itself, but need a
  // token with ads_read - fall back to the base fields so a narrower token
  // still delivers the lead.
  let res = await get([...base, 'ad_name', 'adset_name', 'campaign_name']);
  if (!res.ok) res = await get(base);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Meta Graph API error ${res.status}: ${errText}`);
  }

  return res.json() as Promise<MetaRawLead>;
}

/** Fetches lead form details (name) from Meta Graph API */
export async function fetchFormName(formId: string): Promise<string | null> {
  try {
    const url = `${BASE}/${apiVersion()}/${formId}?fields=name&access_token=${await getMetaPageAccessToken()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json() as { name?: string };
    return data.name ?? null;
  } catch {
    return null;
  }
}

/** Fetches campaign info from Meta Marketing API */
export async function fetchCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
  const fields = 'id,name,status,objective,daily_budget,lifetime_budget,insights{spend,impressions,clicks}';
  const results: MetaCampaign[] = [];
  // The Marketing API rejects Page tokens, so prefer a user/system-user token with ads_read.
  const token = process.env.META_ADS_ACCESS_TOKEN || (await getMetaPageAccessToken());
  let nextUrl: string | null =
    `${BASE}/${apiVersion()}/act_${adAccountId}/campaigns?fields=${fields}&limit=100&access_token=${token}`;

  // Handle pagination
  while (nextUrl) {
    const res = await fetch(nextUrl, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Meta Marketing API error ${res.status}: ${err}`);
    }
    const data = await res.json() as { data: MetaCampaign[]; paging?: { next?: string } };
    results.push(...(data.data ?? []));
    nextUrl = data.paging?.next ?? null;
  }

  return results;
}

/** Verifies the configured access token is valid */
export async function testMetaConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    const token = await getMetaPageAccessToken();
    const url = `${BASE}/${apiVersion()}/me?fields=id,name&access_token=${token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, message: `API returned ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json() as { id?: string; name?: string };
    return { ok: true, message: `Connected as: ${data.name ?? data.id ?? 'unknown'}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Auto-sync helpers ────────────────────────────────────────────────────────

const FORM_FIELDS = 'id,name,status,locale,created_time,questions{key,label,type}';

async function graphJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), ...init });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`Meta Graph API error ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** App-level token built from META_APP_ID|META_APP_SECRET (never expires). */
export function appAccessToken(): string {
  const id = process.env.META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!id || !secret) throw new Error('META_APP_ID / META_APP_SECRET are not set');
  return `${id}|${secret}`;
}

/** Every lead form (with its questions) on the Page - includes forms created after setup. */
export async function fetchPageLeadForms(pageId: string): Promise<MetaLeadForm[]> {
  const token = await getMetaPageAccessToken();
  const forms: MetaLeadForm[] = [];
  let next: string | null =
    `${BASE}/${apiVersion()}/${pageId}/leadgen_forms?fields=${encodeURIComponent(FORM_FIELDS)}&limit=100&access_token=${token}`;
  while (next) {
    const data: { data?: MetaLeadForm[]; paging?: { next?: string } } = await graphJson(next);
    forms.push(...(data.data ?? []));
    next = data.paging?.next ?? null;
  }
  return forms;
}

export async function fetchLeadForm(formId: string): Promise<MetaLeadForm | null> {
  try {
    const token = await getMetaPageAccessToken();
    return await graphJson<MetaLeadForm>(
      `${BASE}/${apiVersion()}/${formId}?fields=${encodeURIComponent(FORM_FIELDS)}&access_token=${token}`,
    );
  } catch (err) {
    console.warn(`[Meta] fetchLeadForm(${formId}) failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Leads submitted on a form since a unix timestamp (used to backfill missed webhooks). */
export async function fetchFormLeads(formId: string, sinceUnix: number, cap = 500): Promise<MetaRawLead[]> {
  const token = await getMetaPageAccessToken();
  const filtering = encodeURIComponent(JSON.stringify([
    { field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix },
  ]));
  const fields = 'id,created_time,ad_id,adset_id,campaign_id,form_id,field_data';
  const out: MetaRawLead[] = [];
  let next: string | null =
    `${BASE}/${apiVersion()}/${formId}/leads?fields=${fields}&filtering=${filtering}&limit=100&access_token=${token}`;
  while (next && out.length < cap) {
    const data: { data?: MetaRawLead[]; paging?: { next?: string } } = await graphJson(next);
    out.push(...(data.data ?? []));
    next = data.paging?.next ?? null;
  }
  return out;
}

/** Ensures the Page is subscribed to this app's `leadgen` webhook field. */
export async function ensurePageSubscribed(pageId: string): Promise<{ subscribed: boolean; changed: boolean }> {
  const token = await getMetaPageAccessToken();
  const appId = process.env.META_APP_ID;
  const current = await graphJson<{ data?: Array<{ id: string; subscribed_fields?: string[] }> }>(
    `${BASE}/${apiVersion()}/${pageId}/subscribed_apps?access_token=${token}`,
  );
  const mine = (current.data ?? []).find(a => a.id === appId);
  if (mine?.subscribed_fields?.includes('leadgen')) return { subscribed: true, changed: false };

  await graphJson(`${BASE}/${apiVersion()}/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: 'leadgen', access_token: token }),
  });
  return { subscribed: true, changed: true };
}

/**
 * Registers/updates the app-level Webhooks subscription (object=page, field=leadgen)
 * so the callback URL does not have to be pasted into the Meta dashboard by hand.
 * Meta immediately calls GET <callbackUrl> with the verify token to confirm it.
 */
export async function registerAppWebhook(callbackUrl: string): Promise<void> {
  const appId = process.env.META_APP_ID;
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!appId || !verifyToken) throw new Error('META_APP_ID / META_WEBHOOK_VERIFY_TOKEN are not set');
  await graphJson(`${BASE}/${apiVersion()}/${appId}/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      object: 'page',
      callback_url: callbackUrl,
      fields: 'leadgen',
      verify_token: verifyToken,
      access_token: appAccessToken(),
    }),
  });
}

export interface MetaTokenHealth {
  isValid: boolean;
  type?: string;
  expiresAt: string | null; // null = never expires
  scopes: string[];
  error?: string;
}

/** Checks the stored Page token against Meta using the app credentials. */
export async function inspectPageToken(): Promise<MetaTokenHealth> {
  try {
    const token = await getMetaPageAccessToken();
    const res = await graphJson<{ data: { is_valid: boolean; type?: string; expires_at?: number; scopes?: string[]; error?: { message: string } } }>(
      `${BASE}/${apiVersion()}/debug_token?input_token=${token}&access_token=${appAccessToken()}`,
    );
    const d = res.data;
    return {
      isValid: !!d.is_valid,
      type: d.type,
      expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null,
      scopes: d.scopes ?? [],
      error: d.error?.message,
    };
  } catch (err) {
    return { isValid: false, expiresAt: null, scopes: [], error: err instanceof Error ? err.message : String(err) };
  }
}
