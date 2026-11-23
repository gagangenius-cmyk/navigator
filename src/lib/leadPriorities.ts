// The one list of lead priorities used by every Priority dropdown / filter in the CRM.
// Edit the wording here and it changes everywhere.
export interface LeadPriorityOption {
  value: 'P1' | 'P2' | 'P3' | 'P4';
  definition: string;
}

export const LEAD_PRIORITIES: LeadPriorityOption[] = [
  { value: 'P1', definition: 'Ready to proceed now - act today' },
  { value: 'P2', definition: 'Strong interest - decision expected soon' },
  { value: 'P3', definition: 'Interested - needs nurturing, no firm timeline' },
  { value: 'P4', definition: 'Low intent / long-term enquiry' },
];

export const DEFAULT_LEAD_PRIORITY = 'P3';

export const priorityLabel = (p: LeadPriorityOption) => `${p.value} - ${p.definition}`;

// Option list for a form: P1-P4, plus the lead's current value when it's an older
// non-P1-P4 priority (High / Hot / Medium...) so opening the form never blanks it.
export function priorityChoices(current?: string | null) {
  const list = LEAD_PRIORITIES.map((p) => ({ value: p.value as string, label: priorityLabel(p) }));
  const cur = String(current || '').trim();
  if (cur && !LEAD_PRIORITIES.some((p) => p.value === cur)) list.push({ value: cur, label: `${cur} (older value)` });
  return list;
}
