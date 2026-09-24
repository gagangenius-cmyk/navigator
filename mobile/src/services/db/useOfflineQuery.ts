import { useQuery, type QueryKey } from '@tanstack/react-query';
import { withOfflineCache, type Cached } from './offline';

interface UseOfflineQueryOptions<T> {
  queryKey: QueryKey;
  /** SQLite cache key. Must be unique per distinct request (include filters). */
  cacheKey: string;
  queryFn: () => Promise<T>;
  enabled?: boolean;
  refetchInterval?: number;
  staleTime?: number;
}

/**
 * A query that survives being offline: the result is mirrored into the encrypted
 * SQLite cache, and if the network is unreachable the last mirrored result is served
 * instead (flagged `fromCache` so the screen can say so). Also marked for the
 * persisted query cache so lists paint instantly on a cold start.
 */
export function useOfflineQuery<T>({ queryKey, cacheKey, queryFn, enabled, refetchInterval, staleTime }: UseOfflineQueryOptions<T>) {
  return useQuery<Cached<T>>({
    queryKey,
    queryFn: () => withOfflineCache(cacheKey, queryFn),
    enabled,
    refetchInterval,
    staleTime,
    meta: { persist: true },
  });
}
