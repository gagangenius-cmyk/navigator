import { getDb } from './sqlite';

// Read-through JSON cache backing offline viewing. Rows are namespaced by the
// signed-in employee so an account switch on a shared phone can never surface
// the previous user's data, and the whole database is destroyed on logout.

let scope = 'anon';

export function setCacheScope(employeeId: number | null): void {
  scope = employeeId ? `u:${employeeId}` : 'anon';
}

export interface CacheHit<T> {
  data: T;
  /** Epoch ms the value was last fetched from the server. */
  updatedAt: number;
}

// Cache failures must never break a screen - the network path still works.
export async function cacheGet<T>(key: string): Promise<CacheHit<T> | null> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ json: string; updated_at: number }>(
      'SELECT json, updated_at FROM cache_entries WHERE scope = ? AND key = ?',
      scope,
      key,
    );
    return row ? { data: JSON.parse(row.json) as T, updatedAt: row.updated_at } : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, data: unknown): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync(
      'INSERT OR REPLACE INTO cache_entries (scope, key, json, updated_at) VALUES (?, ?, ?, ?)',
      scope,
      key,
      JSON.stringify(data),
      Date.now(),
    );
  } catch {
    // best effort
  }
}

/** Drops entries older than `maxAgeMs`. Run occasionally at startup. */
export async function cachePrune(maxAgeMs = 30 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const db = await getDb();
    await db.runAsync('DELETE FROM cache_entries WHERE updated_at < ?', Date.now() - maxAgeMs);
  } catch {
    // best effort
  }
}
