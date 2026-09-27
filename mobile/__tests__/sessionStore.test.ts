/* eslint-disable import/first -- jest.mock() calls must run before the modules they replace are imported */
// In-memory stand-ins for every native/IO dependency of the session store.
const mockSecure = new Map<string, string>();
const mockKv = new Map<string, string>();

jest.mock('@/constants/config', () => ({
  API_BASE_URL: 'https://api.test',
  APP_VERSION: '1.0.0',
  REQUEST_TIMEOUT_MS: 5000,
  ACCESS_TOKEN_REFRESH_SKEW_MS: 60000,
}));
jest.mock('@/services/storage/secureStorage', () => ({
  SECURE_KEYS: { refreshToken: 'refresh', pushToken: 'push', mmkvKey: 'k', dbKey: 'd' },
  secureStorage: {
    get: async (k: string) => mockSecure.get(k) ?? null,
    set: async (k: string, v: string) => void mockSecure.set(k, v),
    remove: async (k: string) => void mockSecure.delete(k),
    getSync: (k: string) => mockSecure.get(k) ?? null,
    setSync: (k: string, v: string) => void mockSecure.set(k, v),
  },
}));
jest.mock('@/services/storage/mmkv', () => ({
  mmkvStorage: {
    getString: (k: string) => mockKv.get(k),
    set: (k: string, v: string) => void mockKv.set(k, v),
    remove: (k: string) => mockKv.delete(k),
    getAllKeys: () => Array.from(mockKv.keys()),
    clearAll: () => mockKv.clear(),
  },
}));
jest.mock('@/services/db/sqlite', () => ({ destroyDb: jest.fn(async () => undefined), getDb: jest.fn() }));
jest.mock('@/services/db/cache', () => ({ setCacheScope: jest.fn(), cacheGet: jest.fn(), cacheSet: jest.fn() }));
jest.mock('@/services/push/cleanup', () => ({ clearDeliveredNotifications: jest.fn(async () => undefined) }));
jest.mock('@/app/queryClient', () => ({ queryClient: { clear: jest.fn() }, PERSISTED_CACHE_KEY: 'rq-cache' }));
jest.mock('@/features/auth/authApi', () => ({
  login: jest.fn(),
  verifyMfa: jest.fn(),
  refreshTokens: jest.fn(),
  logoutRequest: jest.fn(async () => ({})),
}));

import * as authApi from '@/features/auth/authApi';
import { getSessionBridge } from '@/services/api/bridge';
import { ApiError } from '@/services/api/errors';
import { useSessionStore } from '@/store/sessionStore';
import { counselor } from './fixtures';

const mocked = authApi as jest.Mocked<typeof authApi>;

const bundle = (overrides: Partial<{ accessToken: string; refreshToken: string; expiresIn: number }> = {}) => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 3600,
  user: counselor,
  ...overrides,
});

const reset = () => {
  mockSecure.clear();
  mockKv.clear();
  useSessionStore.setState({ status: 'booting', user: null, offlineBoot: false, mfaToken: null, signOutReason: null });
};

beforeEach(() => {
  reset();
  jest.clearAllMocks();
  // clearAllMocks keeps implementations; a leftover one would leak between tests.
  mocked.login.mockReset();
  mocked.verifyMfa.mockReset();
  mocked.refreshTokens.mockReset();
  mocked.logoutRequest.mockResolvedValue({});
});

describe('login', () => {
  it('stores the refresh token in secure storage and the user in memory, never the access token', async () => {
    mocked.login.mockResolvedValueOnce({ kind: 'success', bundle: bundle() });

    expect(await useSessionStore.getState().login('harpreet', 'pw')).toBe('success');

    const state = useSessionStore.getState();
    expect(state.status).toBe('signedIn');
    expect(state.user?.id).toBe(counselor.id);
    expect(mockSecure.get('refresh')).toBe('refresh-1');
    expect(getSessionBridge().getAccessToken()).toBe('access-1');
    // The access token carries the permission list; it must not be persisted anywhere.
    expect(JSON.stringify([...mockSecure.values(), ...mockKv.values()])).not.toContain('access-1');
  });

  it('holds the MFA token in memory and signs in only after the code is verified', async () => {
    mocked.login.mockResolvedValueOnce({ kind: 'mfa', mfaToken: 'pending-1' });
    expect(await useSessionStore.getState().login('roopa', 'pw')).toBe('mfa');
    expect(useSessionStore.getState().status).toBe('booting');
    expect(useSessionStore.getState().mfaToken).toBe('pending-1');

    mocked.verifyMfa.mockResolvedValueOnce(bundle());
    await useSessionStore.getState().verifyMfa('123456');
    expect(mocked.verifyMfa).toHaveBeenCalledWith('pending-1', '123456');
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(useSessionStore.getState().mfaToken).toBeNull();
  });

  it('rejects an MFA code when there is no pending sign-in', async () => {
    await expect(useSessionStore.getState().verifyMfa('123456')).rejects.toThrow(/expired/i);
  });
});

describe('refresh (single-flight)', () => {
  it('shares one network refresh between concurrent callers', async () => {
    mockSecure.set('refresh', 'refresh-0');
    // The gate exists before any call, so the release can never race the mock being invoked.
    let release!: (b: ReturnType<typeof bundle>) => void;
    const gate = new Promise<ReturnType<typeof bundle>>((r) => (release = r));
    mocked.refreshTokens.mockImplementation(() => gate);

    const bridge = getSessionBridge();
    const calls = [bridge.refreshAccessToken(true), bridge.refreshAccessToken(true), bridge.refreshAccessToken(true)];
    // Let the store read the stored token and reach the network call, then answer it once.
    await new Promise((r) => setTimeout(r, 0));
    release(bundle({ refreshToken: 'refresh-2' }));
    await Promise.all(calls);

    expect(mocked.refreshTokens).toHaveBeenCalledTimes(1);
    expect(mockSecure.get('refresh')).toBe('refresh-2'); // rotated
  });

  it('does not refresh while the access token is comfortably valid', async () => {
    mocked.login.mockResolvedValueOnce({ kind: 'success', bundle: bundle() });
    await useSessionStore.getState().login('h', 'p');
    await getSessionBridge().refreshAccessToken(); // not forced
    expect(mocked.refreshTokens).not.toHaveBeenCalled();
  });

  it('signs the user out when the refresh token is rejected (revoked, expired or deactivated)', async () => {
    mocked.login.mockResolvedValueOnce({ kind: 'success', bundle: bundle() });
    await useSessionStore.getState().login('h', 'p');
    mocked.refreshTokens.mockRejectedValueOnce(new ApiError({ kind: 'unauthorized', status: 401, code: 'session_revoked', message: 'Session was revoked.' }));

    await expect(getSessionBridge().refreshAccessToken(true)).rejects.toMatchObject({ kind: 'unauthorized' });

    const state = useSessionStore.getState();
    expect(state.status).toBe('signedOut');
    expect(state.user).toBeNull();
    expect(state.signOutReason).toBe('expired');
    expect(mockSecure.has('refresh')).toBe(false);
    expect(getSessionBridge().getAccessToken()).toBeNull();
  });

  it('keeps the session when the refresh fails only because the network is down', async () => {
    mocked.login.mockResolvedValueOnce({ kind: 'success', bundle: bundle() });
    await useSessionStore.getState().login('h', 'p');
    mocked.refreshTokens.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));

    await expect(getSessionBridge().refreshAccessToken(true)).rejects.toMatchObject({ kind: 'network' });

    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(mockSecure.get('refresh')).toBe('refresh-1');
  });
});

describe('bootstrap', () => {
  it('goes to signed-out with no stored session', async () => {
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(mocked.refreshTokens).not.toHaveBeenCalled();
  });

  it('restores the session (and fresh permissions) from the refresh token', async () => {
    mockSecure.set('refresh', 'refresh-0');
    mocked.refreshTokens.mockResolvedValueOnce(bundle({ refreshToken: 'refresh-3' }));
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(useSessionStore.getState().offlineBoot).toBe(false);
  });

  it('opens from the cached profile when the server is unreachable at launch', async () => {
    mockSecure.set('refresh', 'refresh-0');
    mockKv.set('session.user', JSON.stringify(counselor));
    mocked.refreshTokens.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));

    await useSessionStore.getState().bootstrap();

    expect(useSessionStore.getState().status).toBe('signedIn');
    expect(useSessionStore.getState().offlineBoot).toBe(true);
    expect(useSessionStore.getState().user?.id).toBe(counselor.id);
  });

  it('stays signed out when offline with nothing cached to show', async () => {
    mockSecure.set('refresh', 'refresh-0');
    mocked.refreshTokens.mockRejectedValueOnce(new ApiError({ kind: 'network', message: 'offline' }));
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState().status).toBe('signedOut');
  });

  it('signs out for good when the stored session is dead', async () => {
    mockSecure.set('refresh', 'refresh-0');
    mockKv.set('session.user', JSON.stringify(counselor));
    mocked.refreshTokens.mockRejectedValueOnce(new ApiError({ kind: 'unauthorized', status: 401, message: 'gone' }));
    await useSessionStore.getState().bootstrap();
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(mockKv.has('session.user')).toBe(false); // cached profile wiped, not left for the next user
  });
});

describe('signOut', () => {
  it('revokes the session on the server, wipes user data, and keeps device preferences', async () => {
    mocked.login.mockResolvedValueOnce({ kind: 'success', bundle: bundle() });
    await useSessionStore.getState().login('h', 'p');
    mockSecure.set('push', 'push-token-1');
    mockKv.set('settings', '{"themeMode":"dark"}');
    mockKv.set('some.cache', 'client data');

    await useSessionStore.getState().signOut();

    expect(mocked.logoutRequest).toHaveBeenCalledWith('refresh-1', 'push-token-1');
    expect(useSessionStore.getState().status).toBe('signedOut');
    expect(mockSecure.has('refresh')).toBe(false);
    expect(mockSecure.has('push')).toBe(false);
    expect(mockKv.has('some.cache')).toBe(false);
    expect(mockKv.get('settings')).toBe('{"themeMode":"dark"}');
  });

  it('skips the server call when the session was already dead', async () => {
    mockSecure.set('refresh', 'refresh-0');
    await useSessionStore.getState().signOut({ remote: false });
    expect(mocked.logoutRequest).not.toHaveBeenCalled();
  });
});

describe('markPasswordChanged', () => {
  it('clears the forced-change flag in memory and in the cached profile', async () => {
    mocked.login.mockResolvedValueOnce({ kind: 'success', bundle: bundle({}) });
    await useSessionStore.getState().login('h', 'p');
    useSessionStore.setState({ user: { ...counselor, mustChangePassword: true } });

    useSessionStore.getState().markPasswordChanged();

    expect(useSessionStore.getState().user?.mustChangePassword).toBe(false);
    expect(JSON.parse(mockKv.get('session.user')!).mustChangePassword).toBe(false);
  });
});
