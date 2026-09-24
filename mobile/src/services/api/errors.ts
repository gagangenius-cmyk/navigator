export type ApiErrorKind =
  | 'network'
  | 'timeout'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'client';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  code?: string;
  details?: string[];
  retryAfterSeconds?: number;
  /** Extra fields from the response body (e.g. duplicateLeadId on a 409). */
  body?: unknown;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code?: string;
  readonly details: string[];
  readonly retryAfterSeconds?: number;
  readonly body?: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? 0;
    this.code = init.code;
    this.details = init.details ?? [];
    this.retryAfterSeconds = init.retryAfterSeconds;
    this.body = init.body;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

/** True when the request never got a usable answer - the offline cache may serve instead. */
export const isNetworkError = (error: unknown): boolean =>
  isApiError(error) && (error.kind === 'network' || error.kind === 'timeout');

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 400 || status === 422) return 'validation';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'client';
}

/**
 * Pulls a user-presentable message out of whatever shape the backend used:
 * `{ error }` (most routes), `{ message }` (web auth routes), `{ errors: [] }`
 * (422 validation) or `{ success: false, error }`.
 */
export function messageFromBody(body: unknown, fallback: string): { message: string; details: string[] } {
  if (!body || typeof body !== 'object') return { message: fallback, details: [] };
  const record = body as Record<string, unknown>;
  const details = Array.isArray(record.errors) ? record.errors.filter((e): e is string => typeof e === 'string') : [];
  const primary =
    (typeof record.error === 'string' && record.error) ||
    (typeof record.message === 'string' && record.message) ||
    details[0] ||
    fallback;
  return { message: primary, details };
}

/** Message for any thrown value, safe to show in the UI. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isApiError(error)) {
    if (error.kind === 'network') return 'No connection. Check your internet and try again.';
    if (error.kind === 'timeout') return 'The server took too long to respond. Please try again.';
    if (error.kind === 'forbidden') return error.message || 'You do not have permission to do that.';
    return error.message || fallback;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
