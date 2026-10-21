// Parses the WhatsApp Cloud API webhook payload shape (distinct from the
// existing Lead Ads webhook in src/lib/meta/webhook.ts - same Meta app,
// different product, different payload shape entirely). Kept as pure
// functions operating on `unknown` (never trusting the shape of external
// input) so they're unit-testable without a live webhook call, and so the
// route handler (src/app/api/webhooks/whatsapp/route.ts) stays thin.

export interface WhatsAppStatusChange {
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId: string;
  errorMessage: string | null;
}

/**
 * Click-to-WhatsApp ad attribution. Meta attaches this to the FIRST message a
 * person sends after tapping a "Send WhatsApp message" ad (or a Facebook
 * Page/Instagram CTA button); `sourceId` is the ad id.
 */
export interface WhatsAppReferral {
  sourceType: string | null; // 'ad' | 'post'
  sourceId: string | null;
  sourceUrl: string | null;
  ctwaClid: string | null;
  headline: string | null;
  body: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
}

export interface WhatsAppInboundMessage {
  providerMessageId: string;
  from: string;
  type: string;
  /** Body text for a 'text' message, or the selected button/list-reply title for interactive types. */
  text: string | null;
  /** WhatsApp profile name from the payload's contacts[] block, if sent. */
  profileName: string | null;
  /** Present only when this message originated from a Click-to-WhatsApp ad. */
  referral: WhatsAppReferral | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

const VALID_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

export function extractStatusChanges(payload: unknown): WhatsAppStatusChange[] {
  const root = asRecord(payload);
  if (root.object !== 'whatsapp_business_account') return [];

  const results: WhatsAppStatusChange[] = [];
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      for (const status of asArray(value.statuses)) {
        const s = asRecord(status);
        const id = asString(s.id);
        const statusValue = asString(s.status);
        if (!id || !statusValue || !VALID_STATUSES.has(statusValue)) continue;

        const errors = asArray(s.errors);
        const firstError = errors.length > 0 ? asRecord(errors[0]) : null;

        results.push({
          providerMessageId: id,
          status: statusValue as WhatsAppStatusChange['status'],
          recipientId: asString(s.recipient_id) ?? '',
          errorMessage: firstError ? (asString(firstError.title) ?? asString(firstError.message)) : null,
        });
      }
    }
  }
  return results;
}

function extractReferral(value: unknown): WhatsAppReferral | null {
  const r = asRecord(value);
  const sourceId = asString(r.source_id);
  const ctwaClid = asString(r.ctwa_clid);
  // No ad id and no click id = nothing to attribute; treat as an organic message.
  if (!sourceId && !ctwaClid) return null;
  return {
    sourceType: asString(r.source_type),
    sourceId,
    sourceUrl: asString(r.source_url),
    ctwaClid,
    headline: asString(r.headline),
    body: asString(r.body),
    mediaType: asString(r.media_type),
    mediaUrl: asString(r.image_url) ?? asString(r.video_url) ?? asString(r.thumbnail_url),
  };
}

export function extractInboundMessages(payload: unknown): WhatsAppInboundMessage[] {
  const root = asRecord(payload);
  if (root.object !== 'whatsapp_business_account') return [];

  const results: WhatsAppInboundMessage[] = [];
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      const profileNames = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const c = asRecord(contact);
        const waId = asString(c.wa_id);
        const name = asString(asRecord(c.profile).name);
        if (waId && name) profileNames.set(waId, name);
      }
      for (const message of asArray(value.messages)) {
        const m = asRecord(message);
        const id = asString(m.id);
        const from = asString(m.from);
        const type = asString(m.type);
        if (!id || !from || !type) continue;

        let text: string | null = null;
        if (type === 'text') {
          text = asString(asRecord(m.text).body);
        } else if (type === 'button') {
          text = asString(asRecord(m.button).text);
        } else if (type === 'interactive') {
          const interactive = asRecord(m.interactive);
          const interactiveType = asString(interactive.type);
          if (interactiveType === 'button_reply') text = asString(asRecord(interactive.button_reply).title);
          else if (interactiveType === 'list_reply') text = asString(asRecord(interactive.list_reply).title);
        }

        results.push({
          providerMessageId: id,
          from,
          type,
          text,
          profileName: profileNames.get(from) ?? null,
          referral: extractReferral(m.referral),
        });
      }
    }
  }
  return results;
}

const OPT_OUT_KEYWORDS = new Set(['stop', 'unsubscribe', 'optout', 'opt out', 'cancel', 'stop all']);

export function isOptOutMessage(text: string | null): boolean {
  if (!text) return false;
  return OPT_OUT_KEYWORDS.has(text.trim().toLowerCase());
}
