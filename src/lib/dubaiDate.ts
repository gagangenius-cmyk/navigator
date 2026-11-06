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
