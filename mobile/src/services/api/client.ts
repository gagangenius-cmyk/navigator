import { Platform } from 'react-native';
import { ACCESS_TOKEN_REFRESH_SKEW_MS, APP_VERSION, REQUEST_TIMEOUT_MS } from '@/constants/config';
import { getApiBaseUrl } from './baseUrl';
import { getSessionBridge } from './bridge';
import { ApiError, kindForStatus, messageFromBody } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: HttpMethod;
  query?: Record<string, QueryValue>;
  body?: unknown;
  /**
   * Permissions the caller must hold (any one; 'all' always passes). Checked
   * before the request leaves the device: a screen that slipped past the
   * navigation guard still cannot fire a call the user is not entitled to. The
   * server re-checks regardless.
   */
  requires?: string[];
  /** Set false for endpoints that need no session (login, config). */
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const CLIENT_HEADER = `navigator-mobile/${APP_VERSION} (${Platform.OS})`;

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const base = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return base;
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return pairs.length ? `${base}?${pairs.join('&')}` : base;
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

async function send(path: string, options: RequestOptions, authenticated: boolean): Promise<RawResponse> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Client': CLIENT_HEADER,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (authenticated) {
    const token = getSessionBridge().getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // The web app authenticates with an httpOnly cookie, which wins over the
      // Authorization header server-side (requireAuth reads the cookie first).
      // Never send or store cookies from the app.
      credentials: 'omit',
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 200) };
      }
    }
    return { status: response.status, headers: response.headers, body };
  } catch (error) {
    if (timedOut) throw new ApiError({ kind: 'timeout', message: 'Request timed out' });
    if (options.signal?.aborted) throw error; // caller cancelled - let it propagate untouched
    throw new ApiError({ kind: 'network', message: error instanceof Error ? error.message : 'Network request failed' });
  } finally {
    clearTimeout(timer);
  }
}

function toApiError(response: RawResponse): ApiError {
  const kind = kindForStatus(response.status);
  const { message, details } = messageFromBody(response.body, `Request failed (${response.status})`);
  const body = response.body && typeof response.body === 'object' ? (response.body as Record<string, unknown>) : {};
  const retryAfter = Number(response.headers.get('Retry-After'));
  return new ApiError({
    kind,
    message,
    status: response.status,
    code: typeof body.code === 'string' ? body.code : undefined,
    details,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    body: response.body,
  });
}

function assertPermitted(required: string[], path: string): void {
  const permissions = getSessionBridge().getPermissions();
  if (permissions?.includes('all') || required.some((key) => permissions?.includes(key))) return;
  throw new ApiError({
    kind: 'forbidden',
    status: 403,
    message: 'You do not have permission to do that.',
    code: 'client_rbac',
    body: { path, required },
  });
}

/** Exported for upload.ts, which can't reuse apiRequest (needs a FormData body, no forced JSON Content-Type). */
export async function ensureFreshAccessToken(): Promise<void> {
  const bridge = getSessionBridge();
  const fresh = bridge.getAccessToken() && bridge.getAccessTokenExpiresAt() - Date.now() > ACCESS_TOKEN_REFRESH_SKEW_MS;
  if (!fresh) await bridge.refreshAccessToken();
}

/** Performs an API call and returns the parsed JSON body. Throws ApiError on any failure. */
export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const authenticated = options.auth !== false;
  if (authenticated && options.requires?.length) assertPermitted(options.requires, path);
  if (authenticated) await ensureFreshAccessToken();

  let response = await send(path, options, authenticated);

  // The token was rejected (revoked, or the server clock disagrees): force one
  // refresh and replay the request exactly once.
  if (response.status === 401 && authenticated) {
    await getSessionBridge().refreshAccessToken(true);
    response = await send(path, options, authenticated);
  }

  if (response.status === 403 && authenticated) getSessionBridge().onForbidden();
  if (response.status < 200 || response.status >= 300) throw toApiError(response);
  return response.body as T;
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body: body ?? {} }),
  delete: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    apiRequest<T>(path, { ...options, method: 'DELETE', body }),
};

// ---------- response normalisers ---------------------------------------
// The backend has no single envelope: leads use `{ leads, pagination.pages }`,
// approvals `{ data, pagination.totalPages }`, others a bare array. Each
// feature's api.ts maps its endpoint into these shapes at the edge, so the rest
// of the app never sees the inconsistency.

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number;
}

export interface RawPagination {
  page?: number;
  limit?: number;
  total?: number;
  pages?: number;
  totalPages?: number;
}

export function toPage<T>(items: T[] | undefined | null, pagination: RawPagination | undefined, fallbackPage = 1): Page<T> {
  const list = items ?? [];
  const page = pagination?.page ?? fallbackPage;
  const total = pagination?.total ?? list.length;
  const totalPages = pagination?.totalPages ?? pagination?.pages ?? (pagination?.limit ? Math.ceil(total / pagination.limit) : 1);
  return { items: list, page, total, totalPages: Math.max(totalPages, 1) };
}
