/**
 * Meta Conversions API client for lead quality feedback.
 *
 * This is the *outbound* half of the Meta Lead Ads integration: it reports
 * what happened to a lead after it reached the CRM (contacted, qualified,
 * converted, disqualified) back to Meta, keyed by the same `lead_id`
 * (leadgen_id) the webhook captured on the way in. Meta's docs cover this at
 * "Conversions API for Lead Ads" — sending a server event with `lead_id`
 * lets Meta match it to the original lead without needing hashed PII.
 */

import { getMetaConversionsAccessToken } from './token-store';

function apiVersion(): string {
  return process.env.META_GRAPH_API_VERSION || 'v21.0';
}

function pixelId(): string {
  const id = process.env.META_PIXEL_ID;
  if (!id) throw new Error('META_PIXEL_ID is not configured');
  return id;
}

const BASE = 'https://graph.facebook.com';

export interface ConversionEventResult {
  success: boolean;
  status: number | null;
  body: string | null;
  error: string | null;
  requestPayload: Record<string, unknown>;
}

/**
 * Sends one lead-quality event to Meta's Conversions API for the given
 * leadgen_id. Never throws — failures are captured in the returned result so
 * a Meta outage can't block the CRM's own status-update flow.
 */
export async function sendLeadConversionEvent(
  leadgenId: string,
  eventName: string,
  opts?: { value?: number | null; currency?: string | null },
): Promise<ConversionEventResult> {
  const eventPayload: Record<string, unknown> = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'system_generated',
    lead_id: leadgenId,
  };

  if (opts?.value != null) {
    eventPayload.custom_data = {
      value: opts.value,
      currency: opts.currency || 'AED',
    };
  }

  const requestPayload: Record<string, unknown> = { data: [eventPayload] };
  const testEventCode = process.env.META_TEST_EVENT_CODE;
  if (testEventCode) requestPayload.test_event_code = testEventCode;

  try {
    const token = await getMetaConversionsAccessToken();
    const url = `${BASE}/${apiVersion()}/${pixelId()}/events?access_token=${token}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(15_000),
    });

    const body = await res.text().catch(() => '');
    return {
      success: res.ok,
      status: res.status,
      body: body.slice(0, 2000),
      error: res.ok ? null : `HTTP ${res.status}`,
      requestPayload,
    };
  } catch (err) {
    return {
      success: false,
      status: null,
      body: null,
      error: err instanceof Error ? err.message : String(err),
      requestPayload,
    };
  }
}
