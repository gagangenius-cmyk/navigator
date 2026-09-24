import * as Crypto from 'expo-crypto';
import { createMMKV, type MMKV } from 'react-native-mmkv';
import { SECURE_KEYS, secureStorage } from './secureStorage';

// Fast key-value storage for non-secret app state (preferences, the cached
// user profile, the React Query cache). It is still encrypted at rest with
// AES-256: the key is generated on first launch and kept in the Keychain, so
// the file is useless without the device's secure storage.
function getOrCreateEncryptionKey(): string {
  const existing = secureStorage.getSync(SECURE_KEYS.mmkvKey);
  if (existing) return existing;
  // 24 random bytes -> 32 base64 characters = the 32-byte AES-256 key limit.
  const key = btoa(String.fromCharCode(...Crypto.getRandomBytes(24)));
  secureStorage.setSync(SECURE_KEYS.mmkvKey, key);
  return key;
}

export const mmkvStorage: MMKV = createMMKV({
  id: 'navigator-crm',
  encryptionKey: getOrCreateEncryptionKey(),
  encryptionType: 'AES-256',
  // If the Keychain was reset (restore to a new device) the old file cannot be
  // decrypted: start clean instead of crashing.
  recoveryStrategy: 'discard-on-error',
});

/** Wipes every persisted app value (called on logout). */
export function clearAppStorage(): void {
  mmkvStorage.clearAll();
}
