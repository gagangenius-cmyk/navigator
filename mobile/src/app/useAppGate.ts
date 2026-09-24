import NetInfo from '@react-native-community/netinfo';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { APP_VERSION } from '@/constants/config';
import { fetchMobileConfig } from '@/features/auth/authApi';
import { getApiBaseUrl } from '@/services/api/baseUrl';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { isBelowMinimum } from '@/utils/version';

/** Mirrors device connectivity into the UI store (drives the offline banner). */
export function useNetworkStatus(): void {
  const setOffline = useUiStore((s) => s.setOffline);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      // isInternetReachable is null while unknown - treat only an explicit false as offline.
      setOffline(state.isConnected === false || state.isInternetReachable === false);
    });
    return unsubscribe;
  }, [setOffline]);
}

export type AppGate = { kind: 'ok' } | { kind: 'update'; minVersion: string } | { kind: 'maintenance'; message: string | null };

/**
 * Startup gate from GET /api/mobile/config: lets the backend force an upgrade or put the
 * app in maintenance mode without shipping a build. Fails open: if the config can't be
 * fetched (offline, old server) the app just runs.
 */
export function useAppGate(): AppGate {
  // Subscribing to the override re-renders this hook (and changes the key) when the server changes.
  useSettingsStore((s) => s.serverUrl);
  const { data } = useQuery({
    queryKey: ['mobile-config', getApiBaseUrl()],
    queryFn: fetchMobileConfig,
    staleTime: 5 * 60_000,
    retry: 1,
    refetchOnReconnect: true,
  });

  if (!data) return { kind: 'ok' };
  if (data.maintenance) return { kind: 'maintenance', message: data.maintenanceMessage };
  if (isBelowMinimum(APP_VERSION, data.minAppVersion)) return { kind: 'update', minVersion: data.minAppVersion };
  return { kind: 'ok' };
}
