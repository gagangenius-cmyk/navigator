import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { APNS_ENVIRONMENT, APP_VERSION } from '@/constants/config';
import { api } from '@/services/api/client';
import { isApiError } from '@/services/api/errors';
import { SECURE_KEYS, secureStorage } from '@/services/storage/secureStorage';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

const toPermission = (p: Notifications.NotificationPermissionsStatus): PushPermission =>
  p.granted ? 'granted' : p.canAskAgain ? 'undetermined' : 'denied';

export async function getPushPermission(): Promise<PushPermission> {
  return toPermission(await Notifications.getPermissionsAsync());
}

/**
 * Asks the OS for permission (Android 13+ / iOS). On Android the channels must
 * exist before this is called - see ensureChannels() - or the prompt never shows.
 */
export async function requestPushPermission(): Promise<PushPermission> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) return toPermission(current);
  return toPermission(await Notifications.requestPermissionsAsync());
}

/**
 * Gets this device's native push token (FCM registration token on Android, raw
 * APNs token on iOS) and registers it with the backend for the signed-in
 * employee. Safe to call repeatedly; the server upserts by token, so a phone
 * that changes hands re-binds to the new user.
 *
 * Returns null when push is unavailable (iOS simulator, permission denied,
 * Firebase not configured) - the in-app notification feed still works.
 */
export async function registerDeviceToken(): Promise<string | null> {
  // The iOS simulator has no APNs; Android emulators with Play Services do have FCM.
  if (!Device.isDevice && Platform.OS === 'ios') return null;
  if ((await getPushPermission()) !== 'granted') return null;

  let token: string;
  try {
    const result = await Notifications.getDevicePushTokenAsync();
    if (typeof result.data !== 'string') return null;
    token = result.data;
  } catch {
    // Typically Android without google-services.json: FCM was never initialised.
    return null;
  }

  try {
    await api.post('/api/mobile/devices', {
      token,
      platform: Platform.OS,
      environment: Platform.OS === 'ios' ? APNS_ENVIRONMENT : undefined,
      deviceName: Device.deviceName ?? Device.modelName ?? undefined,
      appVersion: APP_VERSION,
    });
    await secureStorage.set(SECURE_KEYS.pushToken, token);
    return token;
  } catch (error) {
    // Registration is best effort: a 422 means the token format was rejected;
    // anything else (offline) is retried on the next launch or token refresh.
    if (isApiError(error) && error.kind === 'validation') return null;
    return null;
  }
}

export async function unregisterDeviceToken(): Promise<void> {
  const token = await secureStorage.get(SECURE_KEYS.pushToken).catch(() => null);
  if (!token) return;
  await api.delete('/api/mobile/devices', { token }).catch(() => undefined);
  await secureStorage.remove(SECURE_KEYS.pushToken).catch(() => undefined);
}
