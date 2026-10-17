// Template categories and the message purpose each one implies.
//
// A 'transactional' (service) message - appointment confirmations/reminders,
// case follow-ups, payment balance reminders - only needs the ABSENCE of an
// opt-out (see isRecipientEligible in broadcastPreflight.ts). A 'marketing'
// message needs an explicit prior opt-in. The category is the single source
// of truth so a launch and the later per-recipient send re-check always agree.
//
// Review with legal for each jurisdiction you operate in - this encodes the
// common default, it is not a legal determination.

export const TEMPLATE_CATEGORIES = [
  { value: 'marketing', label: 'Marketing / promotion', purpose: 'marketing' },
  { value: 'appointment', label: 'Appointment', purpose: 'transactional' },
  { value: 'follow_up', label: 'Follow-up', purpose: 'transactional' },
  { value: 'payment_reminder', label: 'Payment reminder', purpose: 'transactional' },
  { value: 'service', label: 'Service update', purpose: 'transactional' },
] as const;

export type MessagePurpose = 'marketing' | 'transactional';

export function purposeForCategory(category: string | null | undefined): MessagePurpose {
  const match = TEMPLATE_CATEGORIES.find((c) => c.value === category);
  // Unknown / unset category is treated as marketing: the safe default is the
  // stricter consent rule, never the looser one.
  return match?.purpose === 'transactional' ? 'transactional' : 'marketing';
}
