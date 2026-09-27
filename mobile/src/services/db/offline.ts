import { isNetworkError } from '@/services/api/errors';
import { cacheGet, cacheSet } from './cache';

/** A value plus where it came from, so screens can show a "last synced" banner. */
export interface Cached<T> {
  data: T;
  fromCache: boolean;
  /** Epoch ms of the last successful fetch from the server. */
  syncedAt: number;
}

/**
 * Stale-while-offline: try the network and remember the answer; if the network
 * is unreachable, fall back to the last remembered answer. Only connectivity
 * failures fall back - a 403 or 500 is a real answer and is thrown as usual.
 *
 * Offline is read-only by design: mutations never go through here.
 */
export async function withOfflineCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  options: { cache?: boolean } = {},
): Promise<Cached<T>> {
  const useCache = options.cache !== false;
  try {
    const data = await fetcher();
    if (useCache) void cacheSet(cacheKey, data);
    return { data, fromCache: false, syncedAt: Date.now() };
  } catch (error) {
    if (useCache && isNetworkError(error)) {
      const hit = await cacheGet<T>(cacheKey);
      if (hit) return { data: hit.data, fromCache: true, syncedAt: hit.updatedAt };
    }
    throw error;
  }
}
