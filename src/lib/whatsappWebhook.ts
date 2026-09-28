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

export interface WhatsAppInboundMessage {
  providerMessageId: string;
  from: string;
  type: string;
  /** Body text for a 'text' message, or the selected button/list-reply title for interactive types. */
  text: string | null;
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

export function extractInboundMessages(payload: unknown): WhatsAppInboundMessage[] {
  const root = asRecord(payload);
  if (root.object !== 'whatsapp_business_account') return [];

  const results: WhatsAppInboundMessage[] = [];
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
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

        results.push({ providerMessageId: id, from, type, text });
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
