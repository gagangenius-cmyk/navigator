import { validateNewPassword } from '@/features/auth/passwordRules';
import { isFollowUpOverdue } from '@/features/leads/followUpRules';
import { hasErrors, validateLeadForm } from '@/features/leads/leadValidation';
import { targetForNotification } from '@/features/notifications/target';
import type { NotificationRow } from '@/features/notifications/api';
import { getPinningConfig } from '@/services/security/sslPinning';
import { leadStatusTone, toneFromTailwind } from '@/theme/status';
import { formatCurrency, fullName, initials, parseServerDate, timeAgo, toIsoDate } from '@/utils/format';
import { cleanPhone, dialUrl, whatsappUrl } from '@/utils/phone';
import { compareVersions, isBelowMinimum } from '@/utils/version';
import { accounts, ceo, counselor } from './fixtures';

// react-native / expo modules pulled in transitively by a few of the imports above.
jest.mock('@/constants/config', () => ({ API_BASE_URL: 'https://crm.example.com', APP_VERSION: '1.0.0' }));

describe('versions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });
  it('flags an app older than the backend minimum', () => {
    expect(isBelowMinimum('1.0.0', '1.1.0')).toBe(true);
    expect(isBelowMinimum('1.1.0', '1.1.0')).toBe(false);
    expect(isBelowMinimum('2.0.0', '1.9.9')).toBe(false);
  });
});

describe('server dates', () => {
  it('reads naive server datetimes as UTC and plain dates as local calendar days', () => {
    expect(parseServerDate('2026-09-24 23:30:00')?.toISOString()).toBe('2026-09-24T23:30:00.000Z');
    const day = parseServerDate('2026-09-24');
    expect([day?.getFullYear(), day?.getMonth(), day?.getDate()]).toEqual([2026, 8, 24]);
  });
  it('returns null for junk', () => {
    expect(parseServerDate('')).toBeNull();
    expect(parseServerDate(null)).toBeNull();
    expect(parseServerDate('not a date')).toBeNull();
  });
  it('describes relative time', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    expect(timeAgo('2026-09-24 11:59:40', now)).toBe('just now');
    expect(timeAgo('2026-09-24 11:30:00', now)).toBe('30m ago');
    expect(timeAgo('2026-09-24 09:00:00', now)).toBe('3h ago');
    expect(timeAgo('2026-09-22 12:00:00', now)).toBe('2d ago');
  });
  it('formats local ISO dates', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('formatting helpers', () => {
  it('formats currency, tolerating bad input', () => {
    expect(formatCurrency(1500)).toMatch(/AED 1,?500/);
    expect(formatCurrency('abc')).toBe('AED 0');
    expect(formatCurrency(null, 'INR')).toBe('INR 0');
  });
  it('builds names and initials', () => {
    expect(fullName('Jane', 'Doe')).toBe('Jane Doe');
    expect(fullName(null, null, 'Nobody')).toBe('Nobody');
    expect(initials('Jane Q Doe')).toBe('JD');
    expect(initials('')).toBe('?');
  });
});

describe('phone links', () => {
  it('keeps a leading + and digits', () => {
    expect(cleanPhone(' +971 50-123 4567 ')).toBe('+971501234567');
    expect(cleanPhone('(050) 123')).toBe('050123');
    expect(cleanPhone(null)).toBe('');
  });
  it('builds dial and WhatsApp URLs', () => {
    expect(dialUrl('+971 50 123 4567')).toBe('tel:+971501234567');
    expect(whatsappUrl('+971 50 123 4567')).toBe('https://wa.me/971501234567');
  });
});

describe('status tones', () => {
  it("maps the web app's Tailwind badge classes to native tones", () => {
    expect(toneFromTailwind('bg-red-100 text-red-800')).toBe('danger');
    expect(toneFromTailwind('bg-green-100 text-green-800')).toBe('success');
    expect(toneFromTailwind('bg-amber-100')).toBe('warning');
    expect(toneFromTailwind('bg-stone-100 text-stone-700')).toBe('neutral');
    expect(toneFromTailwind('no classes here')).toBeNull();
    expect(toneFromTailwind(null)).toBeNull();
  });
  it('prefers the server class, then falls back to the status name', () => {
    expect(leadStatusTone('Hot', 'bg-blue-100')).toBe('info');
    expect(leadStatusTone('Hot')).toBe('danger');
    expect(leadStatusTone('Enrolled')).toBe('success');
    expect(leadStatusTone('mystery')).toBe('neutral');
  });
});

describe('lead form validation (mirrors the server)', () => {
  const good = { fname: 'Jane', lname: "O'Neil", email: 'jane@example.com', phone: '+971 50 123 4567' };
  it('accepts a valid lead', () => {
    expect(hasErrors(validateLeadForm(good))).toBe(false);
  });
  it('flags each bad field', () => {
    const errors = validateLeadForm({ fname: '1', lname: '', email: 'nope', phone: '123' });
    expect(Object.keys(errors).sort()).toEqual(['email', 'fname', 'lname', 'phone']);
  });
  it('enforces the 7-15 digit phone rule', () => {
    expect(validateLeadForm({ ...good, phone: '1234567' }).phone).toBeUndefined();
    expect(validateLeadForm({ ...good, phone: '1234567890123456' }).phone).toBeDefined();
  });
});

describe('password change validation', () => {
  it('requires length, difference and confirmation', () => {
    expect(validateNewPassword('old-pass', 'short', 'short')).toMatch(/at least 8/);
    expect(validateNewPassword('samepass1', 'samepass1', 'samepass1')).toMatch(/different/);
    expect(validateNewPassword('old-pass', 'new-password', 'other-password')).toMatch(/match/);
    expect(validateNewPassword('old-pass', 'new-password', 'new-password')).toBeNull();
  });
});

describe('SSL pinning config (placeholder)', () => {
  it('is disabled until pins are configured', () => {
    expect(getPinningConfig('').enabled).toBe(false);
    expect(getPinningConfig(undefined).enabled).toBe(false);
  });
  it('parses comma-separated pins for the API host', () => {
    const config = getPinningConfig('hashA=, hashB=');
    expect(config).toEqual({ enabled: true, hostname: 'crm.example.com', pins: ['hashA=', 'hashB='] });
  });
});

describe('notification feed targets', () => {
  const row = (overrides: Partial<NotificationRow>): NotificationRow => ({
    id: 1, type: 'system', title: 't', message: 'm', priority: 'medium', isRead: false, createdAt: '2026-09-24 10:00:00',
    relatedId: 99, relatedType: 'lead', link: null, ...overrides,
  });

  it('routes push-type rows through the same role-aware router as a push tap', () => {
    expect(targetForNotification(row({ type: 'discount_requested' }), ceo)).toMatchObject({ kind: 'approvals', segment: 'discounts' });
    expect(targetForNotification(row({ type: 'discount_requested' }), counselor)).toBeNull();
    expect(targetForNotification(row({ type: 'payment_submission' }), accounts)).toMatchObject({ kind: 'approvals', segment: 'payments' });
    expect(targetForNotification(row({ type: 'lead_assigned' }), counselor)).toEqual({ kind: 'lead', leadId: 99 });
  });
  it('opens the lead for other lead-related notifications, and nothing for unrelated ones', () => {
    expect(targetForNotification(row({ type: 'followup' }), counselor)).toEqual({ kind: 'lead', leadId: 99 });
    expect(targetForNotification(row({ relatedType: 'appointment' }), counselor)).toBeNull();
    expect(targetForNotification(row({ relatedId: null }), counselor)).toBeNull();
  });
});

describe('follow-up overdue rule', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  it('is overdue only when pending and past its time', () => {
    expect(isFollowUpOverdue('pending', '2026-09-24 11:00:00', now)).toBe(true);
    expect(isFollowUpOverdue('pending', '2026-09-24 13:00:00', now)).toBe(false);
    expect(isFollowUpOverdue('completed', '2026-09-20 11:00:00', now)).toBe(false);
    expect(isFollowUpOverdue('cancelled', '2026-09-20 11:00:00', now)).toBe(false);
  });
  it('is not overdue when the date cannot be read', () => {
    expect(isFollowUpOverdue('pending', 'garbage', now)).toBe(false);
  });
});
