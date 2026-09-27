import { ALLOW_SERVER_OVERRIDE, API_BASE_URL, IS_PRODUCTION } from '@/constants/config';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * The backend the app talks to: the build's default (EXPO_PUBLIC_API_URL), or - in internal builds
 * only - the address the tester entered on the login screen. Production builds ignore any stored
 * override, even one left over from an internal build.
 */
export function getApiBaseUrl(): string {
  if (ALLOW_SERVER_OVERRIDE) {
    const override = useSettingsStore.getState().serverUrl;
    if (override) return override.replace(/\/+$/, '');
  }
  return API_BASE_URL;
}

/** Returns a problem with the API configuration, or null when it is usable. */
export function getConfigProblem(): string | null {
  const url = getApiBaseUrl();
  if (!url) return 'No server is configured. Set EXPO_PUBLIC_API_URL for this build, or enter one under "Server".';
  if (IS_PRODUCTION && !url.startsWith('https://')) return 'Production builds must use an https:// API URL.';
  return null;
}
