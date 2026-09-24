import { create } from 'zustand';
import { ACCESS_TOKEN_REFRESH_SKEW_MS } from '@/constants/config';
import { queryClient, PERSISTED_CACHE_KEY } from '@/app/queryClient';
import * as authApi from '@/features/auth/authApi';
import type { SessionUser, TokenBundle } from '@/features/auth/types';
import { configureSessionBridge } from '@/services/api/bridge';
import { ApiError, isApiError, isNetworkError } from '@/services/api/errors';
import { setCacheScope } from '@/services/db/cache';
import { destroyDb } from '@/services/db/sqlite';
import { clearDeliveredNotifications } from '@/services/push/cleanup';
import { mmkvStorage } from '@/services/storage/mmkv';
import { SECURE_KEYS, secureStorage } from '@/services/storage/secureStorage';

// Owns the signed-in session:
//   - refresh token: Keychain/Keystore only
//   - access token:  memory only (it carries the permission list, so it can be
//     large, and re-minting it on launch also refreshes permissions)
//   - user profile:  encrypted MMKV, so a cold start with no connectivity can
//     still open the offline cache
// Everything else in the app reads the session through the SessionBridge or
// this store's selectors.

export type SessionStatus = 'booting' | 'signedOut' | 'signedIn';

const USER_KEY = 'session.user';

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Signed in from the cached profile because the server was unreachable at launch. */
  offlineBoot: boolean;
  /** Short-lived token proving the password step passed while an MFA code is pending. */
  mfaToken: string | null;
  /** Why the last sign-out happened, so the login screen can explain it. */
  signOutReason: 'expired' | null;

  bootstrap: () => Promise<void>;
  /** Returns 'mfa' when a TOTP code is still required. */
  login: (username: string, password: string) => Promise<'success' | 'mfa'>;
  verifyMfa: (code: string) => Promise<void>;
  signOut: (options?: { remote?: boolean; reason?: 'expired' }) => Promise<void>;
  /** Re-reads the user (and permissions) from the server. */
  refreshUser: () => Promise<void>;
  markPasswordChanged: () => void;
}

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let refreshInFlight: Promise<void> | null = null;
let lastForbiddenRefresh = 0;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readCachedUser(): SessionUser | null {
  try {
    const raw = mmkvStorage.getString(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

/** Removes all per-user data but keeps device preferences (theme, biometric lock). */
function clearUserData(): void {
  for (const key of mmkvStorage.getAllKeys()) {
    if (key !== 'settings') mmkvStorage.remove(key);
  }
  mmkvStorage.remove(PERSISTED_CACHE_KEY);
}

export const useSessionStore = create<SessionState>((set, get) => {
  async function applyBundle(bundle: TokenBundle): Promise<void> {
    accessToken = bundle.accessToken;
    accessTokenExpiresAt = Date.now() + bundle.expiresIn * 1000;
    await secureStorage.set(SECURE_KEYS.refreshToken, bundle.refreshToken);
    mmkvStorage.set(USER_KEY, JSON.stringify(bundle.user));
    setCacheScope(bundle.user.id);
    set({ user: bundle.user, status: 'signedIn', offlineBoot: false, mfaToken: null, signOutReason: null });
  }

  async function signOut(options: { remote?: boolean; reason?: 'expired' } = {}): Promise<void> {
    const refreshToken = await secureStorage.get(SECURE_KEYS.refreshToken).catch(() => null);
    const pushToken = await secureStorage.get(SECURE_KEYS.pushToken).catch(() => null);
    if (options.remote !== false && refreshToken) {
      // Don't make the user wait on the network to be signed out locally.
      void authApi.logoutRequest(refreshToken, pushToken).catch(() => undefined);
    }

    accessToken = null;
    accessTokenExpiresAt = 0;
    refreshInFlight = null;
    await secureStorage.remove(SECURE_KEYS.refreshToken).catch(() => undefined);
    await secureStorage.remove(SECURE_KEYS.pushToken).catch(() => undefined);
    clearUserData();
    queryClient.clear();
    setCacheScope(null);
    void clearDeliveredNotifications();
    await destroyDb();
    set({ status: 'signedOut', user: null, offlineBoot: false, mfaToken: null, signOutReason: options.reason ?? null });
  }

  async function refreshOnce(): Promise<void> {
    const refreshToken = await secureStorage.get(SECURE_KEYS.refreshToken);
    if (!refreshToken) {
      await signOut({ remote: false, reason: 'expired' });
      throw new ApiError({ kind: 'unauthorized', status: 401, message: 'Please sign in again.' });
    }

    const attempt = async (token: string) => applyBundle(await authApi.refreshTokens(token));
    try {
      await attempt(refreshToken);
    } catch (error) {
      // Another refresh (e.g. a retry after a dropped response) rotated the token a
      // moment ago. Wait for it to settle, then retry once with whatever is stored.
      if (isApiError(error) && error.code === 'refresh_conflict') {
        await delay(1500);
        const latest = await secureStorage.get(SECURE_KEYS.refreshToken);
        if (latest && latest !== refreshToken) return attempt(latest);
      }
      // 401 from the refresh endpoint is definitive: revoked, expired or deactivated.
      if (isApiError(error) && error.kind === 'unauthorized') await signOut({ remote: false, reason: 'expired' });
      throw error;
    }
  }

  const bridge = {
    getAccessToken: () => accessToken,
    getAccessTokenExpiresAt: () => accessTokenExpiresAt,
    getPermissions: () => get().user?.permissions ?? null,
    refreshAccessToken: async (force = false): Promise<void> => {
      if (!force && accessToken && accessTokenExpiresAt - Date.now() > ACCESS_TOKEN_REFRESH_SKEW_MS) return;
      // Single-flight: concurrent requests that all hit an expired token share one refresh.
      if (!refreshInFlight) {
        refreshInFlight = refreshOnce().finally(() => {
          refreshInFlight = null;
        });
      }
      return refreshInFlight;
    },
    onForbidden: () => {
      // The server disagreed with the app's idea of this user's permissions - re-read
      // them, but no more than once every 30s so a stuck screen can't hammer the server.
      if (Date.now() - lastForbiddenRefresh < 30_000 || get().status !== 'signedIn') return;
      lastForbiddenRefresh = Date.now();
      void get().refreshUser().catch(() => undefined);
    },
  };
  configureSessionBridge(bridge);

  return {
    status: 'booting',
    user: null,
    offlineBoot: false,
    mfaToken: null,
    signOutReason: null,

    bootstrap: async () => {
      const refreshToken = await secureStorage.get(SECURE_KEYS.refreshToken).catch(() => null);
      if (!refreshToken) {
        set({ status: 'signedOut', user: null });
        return;
      }

      const cachedUser = readCachedUser();
      if (cachedUser) setCacheScope(cachedUser.id);
      try {
        await bridge.refreshAccessToken(true);
      } catch (error) {
        // Unreachable server (airplane mode, tunnel): open from the cached profile so
        // the offline cache is still readable. A dead session already signed out above.
        const transient = isNetworkError(error) || (isApiError(error) && error.kind === 'server');
        if (transient && cachedUser) {
          set({ status: 'signedIn', user: cachedUser, offlineBoot: true });
        } else if (get().status === 'booting') {
          set({ status: 'signedOut', user: null });
        }
      }
    },

    login: async (username, password) => {
      const result = await authApi.login(username, password);
      if (result.kind === 'mfa') {
        set({ mfaToken: result.mfaToken });
        return 'mfa';
      }
      await applyBundle(result.bundle);
      return 'success';
    },

    verifyMfa: async (code) => {
      const mfaToken = get().mfaToken;
      if (!mfaToken) throw new ApiError({ kind: 'client', message: 'Your sign-in attempt expired. Please start again.' });
      await applyBundle(await authApi.verifyMfa(mfaToken, code));
    },

    signOut,

    refreshUser: async () => {
      await bridge.refreshAccessToken(true);
    },

    markPasswordChanged: () => {
      const user = get().user;
      if (!user) return;
      const next = { ...user, mustChangePassword: false };
      mmkvStorage.set(USER_KEY, JSON.stringify(next));
      set({ user: next });
    },
  };
});

export const selectUser = (state: SessionState) => state.user;
export const selectStatus = (state: SessionState) => state.status;
