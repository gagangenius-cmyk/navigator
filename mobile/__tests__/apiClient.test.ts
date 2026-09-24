/* eslint-disable import/first -- jest.mock() calls must run before the modules they replace are imported */
jest.mock('@/services/api/baseUrl', () => ({ getApiBaseUrl: () => 'https://api.test' }));
jest.mock('@/constants/config', () => ({
  API_BASE_URL: 'https://api.test',
  APP_VERSION: '1.0.0',
  REQUEST_TIMEOUT_MS: 5000,
  ACCESS_TOKEN_REFRESH_SKEW_MS: 60000,
}));

import { configureSessionBridge, type SessionBridge } from '@/services/api/bridge';
import { api, apiRequest, buildUrl, toPage } from '@/services/api/client';
import { ApiError, errorMessage, isNetworkError, kindForStatus, messageFromBody } from '@/services/api/errors';

const fetchMock = jest.fn();
(global as unknown as { fetch: unknown }).fetch = fetchMock;

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function makeBridge(overrides: Partial<SessionBridge> = {}) {
  const state = { token: 'token-1' as string | null, expiresAt: Date.now() + 10 * 60_000 };
  const bridge: SessionBridge = {
    getAccessToken: () => state.token,
    getAccessTokenExpiresAt: () => state.expiresAt,
    getPermissions: () => ['leads.view'],
    refreshAccessToken: jest.fn(async () => {
      state.token = 'token-2';
      state.expiresAt = Date.now() + 10 * 60_000;
    }),
    onForbidden: jest.fn(),
    ...overrides,
  };
  configureSessionBridge(bridge);
  return { bridge, state };
}

beforeEach(() => fetchMock.mockReset());

describe('buildUrl', () => {
  it('joins the base and path and encodes query values', () => {
    expect(buildUrl('/api/leads', { search: 'a b&c', page: 2 })).toBe('https://api.test/api/leads?search=a%20b%26c&page=2');
  });
  it('drops empty, null and undefined params', () => {
    expect(buildUrl('/api/x', { a: '', b: null, c: undefined, d: 0, e: false })).toBe('https://api.test/api/x?d=0&e=false');
    expect(buildUrl('/api/x', {})).toBe('https://api.test/api/x');
  });
  it('tolerates a path without a leading slash', () => {
    expect(buildUrl('api/x')).toBe('https://api.test/api/x');
  });
});

describe('toPage', () => {
  it('reads the leads-style `pages` key', () => {
    expect(toPage([1, 2], { page: 2, total: 40, pages: 4 })).toEqual({ items: [1, 2], page: 2, total: 40, totalPages: 4 });
  });
  it('reads the approvals-style `totalPages` key', () => {
    expect(toPage([1], { page: 1, total: 60, totalPages: 3 }).totalPages).toBe(3);
  });
  it('derives pages from limit, and defaults sanely with no pagination', () => {
    expect(toPage([1], { total: 45, limit: 20 }).totalPages).toBe(3);
    expect(toPage(undefined, undefined)).toEqual({ items: [], page: 1, total: 0, totalPages: 1 });
  });
});

describe('apiRequest', () => {
  it('sends the Bearer token, omits cookies, and parses JSON', async () => {
    makeBridge();
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }));

    const result = await api.get<{ ok: boolean }>('/api/leads');

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/leads');
    expect(init.headers.Authorization).toBe('Bearer token-1');
    expect(init.headers['X-Client']).toContain('navigator-mobile/1.0.0');
    // A stale web cookie would otherwise override the header server-side.
    expect(init.credentials).toBe('omit');
  });

  it('serialises JSON bodies with a content type', async () => {
    makeBridge();
    fetchMock.mockResolvedValueOnce(response(201, { id: 5 }));
    await api.post('/api/lead-remarks', { leadId: 1 });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"leadId":1}');
  });

  it('skips the token for unauthenticated endpoints and never tries to refresh', async () => {
    const { bridge } = makeBridge();
    fetchMock.mockResolvedValueOnce(response(200, {}));
    await apiRequest('/api/mobile/config', { auth: false });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
    expect(bridge.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes proactively when the token is about to expire', async () => {
    const { bridge } = makeBridge();
    (bridge.getAccessTokenExpiresAt as () => number) = () => Date.now() + 10_000; // inside the 60s skew
    fetchMock.mockResolvedValueOnce(response(200, {}));
    await api.get('/api/leads');
    expect(bridge.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('on a 401 forces one refresh and replays the request with the new token', async () => {
    const { bridge } = makeBridge();
    fetchMock.mockResolvedValueOnce(response(401, { error: 'Authentication is required' })).mockResolvedValueOnce(response(200, { ok: 1 }));

    const result = await api.get('/api/leads');

    expect(result).toEqual({ ok: 1 });
    expect(bridge.refreshAccessToken).toHaveBeenCalledWith(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-2');
  });

  it('gives up after a single replay if the server still says 401', async () => {
    makeBridge();
    fetchMock.mockResolvedValue(response(401, { error: 'Authentication is required' }));
    await expect(api.get('/api/leads')).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('propagates a dead session from the refresh instead of retrying', async () => {
    makeBridge({
      refreshAccessToken: jest.fn(async () => {
        throw new ApiError({ kind: 'unauthorized', status: 401, message: 'Session expired' });
      }),
    });
    fetchMock.mockResolvedValueOnce(response(401, {}));
    await expect(api.get('/api/leads')).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('client-side RBAC', () => {
    it('blocks a call the user lacks the permission for, before any network traffic', async () => {
      makeBridge({ getPermissions: () => ['leads.view'] });
      await expect(api.get('/api/admin/payment-verification', { requires: ['finance.view', 'payments.view'] })).rejects.toMatchObject({
        kind: 'forbidden',
        status: 403,
        code: 'client_rbac',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('allows the call when any one required permission is held', async () => {
      makeBridge({ getPermissions: () => ['payments.view'] });
      fetchMock.mockResolvedValueOnce(response(200, {}));
      await api.get('/api/admin/payment-verification', { requires: ['finance.view', 'payments.view'] });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("treats 'all' as holding every permission", async () => {
      makeBridge({ getPermissions: () => ['all'] });
      fetchMock.mockResolvedValueOnce(response(200, {}));
      await api.get('/api/anything', { requires: ['nope'] });
      expect(fetchMock).toHaveBeenCalled();
    });

    it('denies when there is no session permission list at all', async () => {
      makeBridge({ getPermissions: () => null });
      await expect(api.get('/api/x', { requires: ['leads.view'] })).rejects.toMatchObject({ kind: 'forbidden' });
    });

    it('turns a server 403 into a forbidden error and asks the session to re-read permissions', async () => {
      const { bridge } = makeBridge();
      fetchMock.mockResolvedValueOnce(response(403, { error: 'You do not have permission to perform this action' }));
      await expect(api.get('/api/leads')).rejects.toMatchObject({ kind: 'forbidden', message: 'You do not have permission to perform this action' });
      expect(bridge.onForbidden).toHaveBeenCalledTimes(1);
    });
  });

  describe('error mapping', () => {
    it('maps status codes to kinds', () => {
      expect(kindForStatus(401)).toBe('unauthorized');
      expect(kindForStatus(403)).toBe('forbidden');
      expect(kindForStatus(404)).toBe('not_found');
      expect(kindForStatus(409)).toBe('conflict');
      expect(kindForStatus(422)).toBe('validation');
      expect(kindForStatus(429)).toBe('rate_limited');
      expect(kindForStatus(503)).toBe('server');
    });

    it('reads the message from whichever envelope the backend used', () => {
      expect(messageFromBody({ error: 'boom' }, 'x').message).toBe('boom');
      expect(messageFromBody({ message: 'Invalid email or password' }, 'x').message).toBe('Invalid email or password');
      expect(messageFromBody({ success: false, error: 'nope' }, 'x').message).toBe('nope');
      expect(messageFromBody({ error: 'Lead validation failed', errors: ['A', 'B'] }, 'x')).toEqual({ message: 'Lead validation failed', details: ['A', 'B'] });
      expect(messageFromBody(null, 'fallback').message).toBe('fallback');
    });

    it('surfaces 422 details, conflict bodies and Retry-After', async () => {
      makeBridge();
      fetchMock.mockResolvedValueOnce(response(422, { error: 'Lead validation failed', errors: ['A valid email address is required.'] }));
      await expect(api.post('/api/leads', {})).rejects.toMatchObject({ kind: 'validation', details: ['A valid email address is required.'] });

      fetchMock.mockResolvedValueOnce(response(409, { error: 'Duplicate', duplicateLeadId: 77 }));
      await expect(api.post('/api/leads', {})).rejects.toMatchObject({ kind: 'conflict', body: { duplicateLeadId: 77 } });

      fetchMock.mockResolvedValueOnce(response(429, { message: 'Too many login attempts.' }, { 'Retry-After': '120' }));
      await expect(api.post('/api/mobile/auth/login', {}, { auth: false })).rejects.toMatchObject({ kind: 'rate_limited', retryAfterSeconds: 120 });
    });

    it('classifies a failed fetch as a network error', async () => {
      makeBridge();
      fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
      const error = (await api.get('/api/leads').catch((e: unknown) => e)) as ApiError;
      expect(error).toBeInstanceOf(ApiError);
      expect(error.kind).toBe('network');
      expect(isNetworkError(error)).toBe(true);
      expect(errorMessage(error)).toMatch(/connection/i);
    });

    it('does not treat an HTTP error as a network error (so the offline cache is not used for a 500)', () => {
      expect(isNetworkError(new ApiError({ kind: 'server', status: 500, message: 'x' }))).toBe(false);
    });
  });
});
