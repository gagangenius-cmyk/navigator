// Display formatting. The backend returns DATETIME columns as 'YYYY-MM-DD HH:mm:ss'
// strings (mysql2 dateStrings) written in UTC by Sequelize, while plain dates are
// 'YYYY-MM-DD'. Parse accordingly so a 23:30 UTC follow-up does not shift a day.

export function parseServerDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  let iso = text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) iso = `${text}T00:00:00`; // date only: local calendar day
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) iso = `${text.replace(' ', 'T')}Z`; // naive datetime: UTC
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = parseServerDate(value);
  return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = parseServerDate(value);
  if (!date) return '—';
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

/** A TIME column ('HH:mm:ss') as a short local time, e.g. "14:30". */
export function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : value;
}

export function timeAgo(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = parseServerDate(value);
  if (!date) return '';
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}

export function formatNumber(value: number | string | null | undefined): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0';
}

export function formatCurrency(value: number | string | null | undefined, currency = 'AED'): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : 0;
  return `${currency} ${safe.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function fullName(first?: string | null, last?: string | null, fallback = 'Unknown'): string {
  return `${first ?? ''} ${last ?? ''}`.trim() || fallback;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Local YYYY-MM-DD, for date pickers and API params. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
