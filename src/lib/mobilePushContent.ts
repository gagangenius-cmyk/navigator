// Pure (no DB, no network) half of the mobile push pipeline: which
// notifications are pushed, and what the push says. The DB lookups and the
// delivery live in mobilePush.ts / mobilePushTransport.ts; keeping this part
// dependency-free is what lets tests/unit/mobilePush.test.ts exercise it alone.
//
// Pushed events (recipients are decided by whoever creates the notification):
//   lead_assigned          -> the counselor           [Call] [View Profile]
//   discount_requested     -> CEO (pending requests)  [Approve] [Reject]
//   payment_submission     -> CEO (Accounts approval) [Approve] [Reject]
//   compliance_submission  -> CEO                     [Sign-off]

export const PUSH_TYPES = ['lead_assigned', 'discount_requested', 'compliance_submission', 'payment_submission'] as const;
export type PushType = (typeof PUSH_TYPES)[number];

export type PushCategory = 'LEAD_ASSIGNED' | 'DISCOUNT_APPROVAL' | 'ACCOUNT_APPROVAL' | 'COMPLIANCE_APPROVAL';

export interface PushPayload {
  title: string;
  body: string;
  /** Custom fields, all string values (FCM requires it). Delivered as notification.data. */
  data: Record<string, string>;
  category: PushCategory;
  channelId: 'leads' | 'approvals';
  /** Unique per notification; a re-send replaces the visible notification. */
  tag: string;
  badge: number | null;
}

const CATEGORY_BY_TYPE: Record<PushType, PushCategory> = {
  lead_assigned: 'LEAD_ASSIGNED',
  discount_requested: 'DISCOUNT_APPROVAL',
  payment_submission: 'ACCOUNT_APPROVAL',
  compliance_submission: 'COMPLIANCE_APPROVAL',
};

const REDACTED_TITLE: Record<PushType, string> = {
  lead_assigned: 'New lead assigned',
  discount_requested: 'Discount approval requested',
  payment_submission: 'Payment awaiting verification',
  compliance_submission: 'Compliance approval requested',
};

const REDACTED_BODY = 'Open Navigator CRM to view the details.';

// Keep well under FCM's 4 KB data limit (the body is JSON inside a data value).
export const MAX_DATA_BYTES = 2800;
const MAX_VALUE_LENGTH = 300;

export function isPushEligible(type: unknown): type is PushType {
  return typeof type === 'string' && (PUSH_TYPES as readonly string[]).includes(type);
}

export const categoryFor = (type: PushType): PushCategory => CATEGORY_BY_TYPE[type];
export const channelFor = (type: PushType): 'leads' | 'approvals' => (type === 'lead_assigned' ? 'leads' : 'approvals');

export interface PushSource {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  related_id: number | null;
  related_type: string | null;
}

export interface PushFacts {
  /** Record ids the app needs to open the exact record. Always sent. */
  ids: Record<string, string>;
  /** Names, amounts, phone numbers. Dropped when redaction is on. */
  display: Record<string, string>;
}

export const EMPTY_FACTS: PushFacts = { ids: {}, display: {} };

/** Drops null/empty values and stringifies the rest (FCM data must be strings). */
export function cleanFacts(record: Record<string, string | number | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) out[key] = text.slice(0, MAX_VALUE_LENGTH);
  }
  return out;
}

export interface BuildPushOptions {
  /** Send generic lock-screen text and ids only (no names, amounts or phone numbers). */
  redact: boolean;
  badge: number | null;
}

const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

export function buildPushPayload(source: PushSource, type: PushType, facts: PushFacts, options: BuildPushOptions): PushPayload {
  const category = categoryFor(type);
  const base = cleanFacts({
    type,
    notificationId: source.id,
    category,
    relatedType: source.related_type,
    relatedId: source.related_id,
  });

  let data: Record<string, string> = { ...base, ...facts.ids, ...(options.redact ? {} : facts.display) };

  // Payload budget: shed display fields (largest first) before anything the
  // app needs to route to the right record.
  if (!options.redact) {
    const display = Object.entries(facts.display).sort((a, b) => b[1].length - a[1].length);
    while (byteLength(data) > MAX_DATA_BYTES && display.length) {
      const [key] = display.shift()!;
      delete data[key];
    }
  }
  if (byteLength(data) > MAX_DATA_BYTES) data = { ...base, ...facts.ids };

  return {
    title: options.redact ? REDACTED_TITLE[type] : source.title,
    body: options.redact ? REDACTED_BODY : source.message,
    data,
    category,
    channelId: channelFor(type),
    tag: `n-${source.id}`,
    badge: options.badge,
  };
}
