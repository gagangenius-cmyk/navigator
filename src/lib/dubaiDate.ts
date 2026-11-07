// "Today" for this CRM is the Dubai calendar day (UTC+4, no DST). Server code
// runs in UTC (Vercel), so new Date().toISOString().slice(0, 10) is the UTC
// day, which lags Dubai by one day between 00:00 and 04:00 local and makes
// "today" filters/defaults point at yesterday.
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** YYYY-MM-DD for the current Dubai calendar day (optionally offset by N days). */
export function dubaiToday(offsetDays = 0): string {
  return new Date(Date.now() + DUBAI_OFFSET_MS + offsetDays * 86400000).toISOString().slice(0, 10);
}

/**
 * YYYY-MM-DD for the browser user's own calendar day. Use this in client
 * components for form defaults: new Date().toISOString() is the UTC day, which
 * is yesterday for anyone ahead of UTC in the early hours.
 */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parses a date-time sent by a client into the CRM's stored convention.
 * The CRM stores *wall-clock Dubai* time everywhere (reminder_date, shown as-is by
 * the UI and compared with DATE(...) = today). The web app sends wall-clock text
 * ("2026-11-09T12:00:00"), which new Date() already keeps as-is on the UTC server.
 * The mobile app sends a real instant ("...Z" / "+04:00" via toISOString()); stored
 * unchanged, that is 4 hours early, and after 20:00 UTC lands on the wrong day. So
 * anything carrying a timezone designator is shifted to Dubai wall-clock first.
 */
export function parseCrmDateTime(value: string | Date): Date {
  if (value instanceof Date) return value;
  const text = String(value).trim();
  if (/T\d{2}:\d{2}/.test(text) && /(Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    return new Date(new Date(text).getTime() + DUBAI_OFFSET_MS);
  }
  // Wall-clock text: keep its components exactly (as UTC, which is how Sequelize
  // writes Dates) instead of letting new Date() reinterpret them in whatever
  // timezone the server/dev machine happens to run in.
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) return new Date(`${text.replace(' ', 'T')}Z`);
  return new Date(text);
}

/**
 * Splits a client-supplied follow-up ("2026-11-09T14:30", "2026-11-09 14:30:00" or a
 * bare date) into the lead's DATE and TIME column values. Date-only input gets 09:00
 * rather than midnight, which showed up as a confusing "12:00 AM" follow-up.
 */
export function splitFollowUp(value: unknown): { date: string | null; time: string | null } {
  if (!value) return { date: null, time: null };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { date: null, time: null } : { date: value.toISOString().slice(0, 10), time: value.toISOString().slice(11, 19) };
  }
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::(\d{2}))?)?/);
  if (!match) return { date: null, time: null };
  return { date: match[1], time: match[2] ? `${match[2]}:${match[3] || '00'}` : '09:00:00' };
}

/** YYYY-MM-DD of any Date in the viewer's own timezone (unlike toISOString(), which is UTC). */
export function toLocalDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * UTC bounds ('YYYY-MM-DD HH:mm:ss', start inclusive / end exclusive) of the last `days` Dubai calendar
 * days ending on `endDate` (a Dubai YYYY-MM-DD, default today). Tables that store UTC timestamps
 * (crm_remarks.created_at ...) must be compared against these, not against a bare date.
 */
export function dubaiDayRangeUtc(endDate: string = dubaiToday(), days = 1): { startUtc: string; endUtc: string; dates: string[] } {
  const safeDays = Math.min(Math.max(Math.floor(days) || 1, 1), 62);
  const [y, m, d] = endDate.split('-').map(Number);
  const endDayStartUtcMs = Date.UTC(y, (m || 1) - 1, d || 1) - DUBAI_OFFSET_MS;
  const startUtcMs = endDayStartUtcMs - (safeDays - 1) * 86400000;
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const dates = Array.from({ length: safeDays }, (_, i) => new Date(startUtcMs + DUBAI_OFFSET_MS + i * 86400000).toISOString().slice(0, 10));
  return { startUtc: fmt(startUtcMs), endUtc: fmt(endDayStartUtcMs + 86400000), dates };
}

/** The Dubai calendar day (YYYY-MM-DD) of a UTC 'YYYY-MM-DD HH:mm:ss' / ISO timestamp. */
export function dubaiDayOfUtc(value: string | Date): string {
  const text = value instanceof Date ? value.toISOString() : String(value).trim().replace(' ', 'T');
  const date = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
  return new Date(date.getTime() + DUBAI_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Parses a server timestamp. The API returns UTC datetimes as 'YYYY-MM-DD HH:MM:SS' (no zone); new Date() reads
 * that as the browser's LOCAL time, so in Dubai every "x ago" came out 4 hours too old. Zone-less values are UTC.
 */
export function parseUtcTimestamp(value: string | Date | null | undefined): Date {
  if (value instanceof Date) return value;
  const text = String(value ?? '').trim();
  if (!text) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) return new Date(`${text.replace(' ', 'T')}Z`);
  return new Date(text);
}
