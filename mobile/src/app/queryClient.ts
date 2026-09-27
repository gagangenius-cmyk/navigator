import NetInfo from '@react-native-community/netinfo';
import { QueryClient, onlineManager } from '@tanstack/react-query';
import { isApiError } from '@/services/api/errors';

// Errors that retrying cannot fix.
const NO_RETRY = new Set(['unauthorized', 'forbidden', 'not_found', 'validation', 'conflict', 'rate_limited']);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Long enough for the persisted cache to be useful on a cold start.
      gcTime: 24 * 60 * 60 * 1000,
      // Queries decide for themselves what "offline" means (they fall back to the
      // SQLite cache), so they must run rather than pause when there is no network.
      networkMode: 'always',
      retry: (failureCount, error) => !(isApiError(error) && NO_RETRY.has(error.kind)) && failureCount < 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      networkMode: 'always',
      retry: false,
    },
  },
});

// Tell React Query when connectivity flips so it refetches on reconnect.
onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
);

export const PERSISTED_CACHE_KEY = 'react-query-cache';
