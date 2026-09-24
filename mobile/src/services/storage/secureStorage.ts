import * as SecureStore from 'expo-secure-store';

// Secrets live in the iOS Keychain / Android Keystore (via expo-secure-store),
// never in AsyncStorage, MMKV or SQLite. THIS_DEVICE_ONLY keeps them out of
// iCloud/device backups and off any other device the user restores to;
// AFTER_FIRST_UNLOCK lets background work read them once the phone has been
// unlocked after boot.
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export const SECURE_KEYS = {
  /** Rotating refresh token. The short-lived access token is memory-only. */
  refreshToken: 'nav.refresh-token',
  /** AES key for the encrypted MMKV store. */
  mmkvKey: 'nav.mmkv-key',
  /** SQLCipher key for the offline cache database. */
  dbKey: 'nav.db-key',
  /** Last push token this device registered, so logout can unregister it. */
  pushToken: 'nav.push-token',
} as const;

export const secureStorage = {
  /** Synchronous read - blocks the JS thread; use only during startup key setup. */
  getSync: (key: string): string | null => SecureStore.getItem(key, OPTIONS),
  setSync: (key: string, value: string): void => SecureStore.setItem(key, value, OPTIONS),
  get: (key: string): Promise<string | null> => SecureStore.getItemAsync(key, OPTIONS),
  set: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value, OPTIONS),
  remove: (key: string): Promise<void> => SecureStore.deleteItemAsync(key, OPTIONS),
};
