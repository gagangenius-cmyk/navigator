import { DarkTheme, DefaultTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { EmptyState, Screen, ToastHost } from '@/components';
import { APP_VERSION } from '@/constants/config';
import { LockScreen, useAppLock } from '@/features/auth/AppLock';
import { linking } from '@/navigation/linking';
import { navigationRef } from '@/navigation/navigationRef';
import { PushNavigationBridge } from '@/navigation/PushNavigationBridge';
import { RootNavigator } from '@/navigation/RootNavigator';
import { cachePrune } from '@/services/db/cache';
import { configureForegroundHandler, usePushNotifications } from '@/services/push';
import { initSslPinning } from '@/services/security/sslPinning';
import { mmkvStorage } from '@/services/storage/mmkv';
import { selectStatus, useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { ErrorBoundary } from './ErrorBoundary';
import { PERSISTED_CACHE_KEY, queryClient } from './queryClient';
import { useAppGate, useNetworkStatus } from './useAppGate';

// Both must happen at module scope, before anything can render or any notification can arrive.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
configureForegroundHandler();

// The React Query cache is mirrored to the encrypted MMKV store (only queries marked
// `meta.persist`), so lists paint instantly on a cold start. It is wiped on sign-out.
const persister = createSyncStoragePersister({
  key: PERSISTED_CACHE_KEY,
  throttleTime: 1000,
  storage: {
    getItem: (key) => mmkvStorage.getString(key) ?? null,
    setItem: (key, value) => mmkvStorage.set(key, value),
    removeItem: (key) => void mmkvStorage.remove(key),
  },
});

function Shell() {
  const { colors, isDark } = useTheme();
  const status = useSessionStore(selectStatus);
  const locked = useUiStore((s) => s.locked);
  const gate = useAppGate();
  const [navReady, setNavReady] = useState(false);

  useNetworkStatus();
  useAppLock();
  usePushNotifications();

  useEffect(() => {
    void useSessionStore.getState().bootstrap();
    void initSslPinning().catch(() => undefined);
    void cachePrune();
  }, []);

  useEffect(() => {
    if (status !== 'booting') void SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  const navTheme = useMemo<NavTheme>(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, notification: colors.danger },
    };
  }, [colors, isDark]);

  if (gate.kind === 'maintenance') {
    return (
      <Screen edges={['top', 'bottom']}>
        <EmptyState icon="construct-outline" title="Down for maintenance" message={gate.message ?? 'Navigator CRM is being updated. Please try again shortly.'} />
      </Screen>
    );
  }
  if (gate.kind === 'update') {
    return (
      <Screen edges={['top', 'bottom']}>
        <EmptyState
          icon="cloud-download-outline"
          title="Update required"
          message={`This version (${APP_VERSION}) is no longer supported. Please install version ${gate.minVersion} or newer.`}
        />
      </Screen>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer ref={navigationRef} linking={linking} theme={navTheme} onReady={() => setNavReady(true)}>
        <RootNavigator />
        <PushNavigationBridge navReady={navReady} />
      </NavigationContainer>
      <ToastHost />
      {locked ? <LockScreen /> : null}
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            maxAge: 24 * 60 * 60 * 1000,
            // A new app version can change response shapes: never restore an older cache into it.
            buster: APP_VERSION,
            dehydrateOptions: { shouldDehydrateQuery: (query) => query.meta?.persist === true && query.state.status === 'success' },
          }}
        >
          <ThemeProvider>
            <Shell />
          </ThemeProvider>
        </PersistQueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
