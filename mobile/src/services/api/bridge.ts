// The API client needs the session (token, permissions, "sign out") but the
// session store itself calls the API to log in and refresh. To keep that from
// becoming an import cycle, the store registers itself here at startup and the
// client only ever talks to this narrow interface.

export interface SessionBridge {
  /** Current in-memory access token, or null when there is none. */
  getAccessToken(): string | null;
  /** Epoch ms at which the access token expires (0 when there is none). */
  getAccessTokenExpiresAt(): number;
  /**
   * Makes sure a usable access token exists, refreshing it if needed (`force`
   * refreshes even when the current one looks valid, e.g. after a 401).
   * Concurrent callers share one refresh. Resolves when a token is ready;
   * rejects with a network ApiError when offline, or unauthorized when the
   * session is dead (the bridge has already signed the user out by then).
   */
  refreshAccessToken(force?: boolean): Promise<void>;
  /** The signed-in user's permissions, for the pre-flight RBAC check. */
  getPermissions(): string[] | null;
  /** The server said 403: permissions may have changed, so re-read them. */
  onForbidden(): void;
}

let bridge: SessionBridge | null = null;

export function configureSessionBridge(next: SessionBridge): void {
  bridge = next;
}

export function getSessionBridge(): SessionBridge {
  if (!bridge) throw new Error('Session bridge is not configured. Call configureSessionBridge() at startup.');
  return bridge;
}
