import type { Tone } from './tokens';

// The web app stores lead-status badge styling as Tailwind class strings in
// crm_lead_status (`bg-red-100 text-red-800`). A native app cannot use those, so
// the colour word is mapped to one of the app's semantic tones - which also makes
// the badges follow light/dark mode.
const TAILWIND_COLOR_TONE: Record<string, Tone> = {
  red: 'danger',
  rose: 'danger',
  orange: 'warning',
  amber: 'warning',
  yellow: 'warning',
  blue: 'info',
  sky: 'info',
  cyan: 'info',
  teal: 'info',
  green: 'success',
  emerald: 'success',
  lime: 'success',
  purple: 'accent',
  violet: 'accent',
  indigo: 'accent',
  fuchsia: 'accent',
  pink: 'accent',
  gray: 'neutral',
  slate: 'neutral',
  stone: 'neutral',
  zinc: 'neutral',
  neutral: 'neutral',
};

export function toneFromTailwind(classes: string | null | undefined): Tone | null {
  const match = /(?:bg|text|border)-([a-z]+)-\d{2,3}/.exec(classes ?? '');
  return match ? (TAILWIND_COLOR_TONE[match[1]] ?? null) : null;
}

// Fallback when the status list has not loaded (offline first launch).
const STATUS_TONE: Record<string, Tone> = {
  new: 'info',
  hot: 'danger',
  warm: 'warning',
  dnp: 'warning',
  cold: 'info',
  junk: 'neutral',
  dead: 'neutral',
  enrolled: 'success',
  converted: 'success',
  client: 'success',
  retained: 'success',
  untouched: 'neutral',
};

export function leadStatusTone(status: string | null | undefined, badgeClass?: string | null): Tone {
  return toneFromTailwind(badgeClass) ?? STATUS_TONE[(status ?? '').trim().toLowerCase()] ?? 'neutral';
}

const PRIORITY_TONE: Record<string, Tone> = {
  p1: 'danger',
  p2: 'warning',
  p3: 'warning',
  p4: 'info',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
  urgent: 'danger',
};

export const priorityTone = (priority: string | null | undefined): Tone =>
  PRIORITY_TONE[(priority ?? '').trim().toLowerCase()] ?? 'neutral';

const APPROVAL_TONE: Record<string, Tone> = {
  pending: 'warning',
  under_review: 'info',
  approved: 'success',
  verified: 'success',
  rejected: 'danger',
  expired: 'neutral',
  completed: 'success',
  cancelled: 'neutral',
  rescheduled: 'accent',
  overdue: 'danger',
};

export const approvalTone = (status: string | null | undefined): Tone =>
  APPROVAL_TONE[(status ?? '').trim().toLowerCase().replace(/\s+/g, '_')] ?? 'neutral';
