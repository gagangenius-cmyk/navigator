// Contract with the backend's push sender (src/lib/mobilePushContent.ts in the
// web repo). Keep the values in sync: the server puts these strings in the
// payload, and the app routes on them.

export const PUSH_TYPES = ['lead_assigned', 'discount_requested', 'compliance_submission', 'payment_submission'] as const;
export type PushType = (typeof PUSH_TYPES)[number];

export const PUSH_CATEGORIES = ['LEAD_ASSIGNED', 'DISCOUNT_APPROVAL', 'ACCOUNT_APPROVAL', 'COMPLIANCE_APPROVAL'] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];

/** Android notification channels created by the app (the server names them in the payload). */
export const CHANNELS = { default: 'default', leads: 'leads', approvals: 'approvals' } as const;

/** Identifiers of the action buttons on a notification. */
export const ACTIONS = {
  approve: 'approve',
  reject: 'reject',
  signOff: 'sign_off',
  call: 'call',
  viewProfile: 'view_profile',
} as const;
export type ActionId = (typeof ACTIONS)[keyof typeof ACTIONS];

/** expo-notifications' identifier for a plain tap on the notification body. */
export const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/**
 * The custom data every push carries. All values are strings (FCM requires it).
 * Only real CRM fields appear here - there is no client tier or risk score in
 * the CRM to send.
 */
export interface PushData {
  type: PushType;
  notificationId?: string;
  category?: PushCategory;
  relatedType?: string;
  relatedId?: string;
  // record ids
  leadId?: string;
  discountApprovalId?: string;
  paymentId?: string;
  complianceApprovalId?: string;
  // display facts (absent when the server redacts)
  leadName?: string;
  phone?: string;
  source?: string;
  clientName?: string;
  discountAmount?: string;
  discountPercent?: string;
  discountType?: string;
  currency?: string;
  requestedBy?: string;
  amount?: string;
  receiptNumber?: string;
  submittedBy?: string;
}

const isPushType = (value: unknown): value is PushType =>
  typeof value === 'string' && (PUSH_TYPES as readonly string[]).includes(value);

/**
 * Validates untrusted notification data. Returns null for anything that is not
 * one of the four CRM events (e.g. a stray notification from another source), so
 * callers never act on a malformed payload.
 */
export function parsePushData(raw: unknown): PushData | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (!isPushType(record.type)) return null;

  const data: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') data[key] = value;
    else if (typeof value === 'number') data[key] = String(value);
  }
  return data as unknown as PushData;
}
