import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { mmkvStorage } from '@/services/storage/mmkv';

export type ThemeMode = 'system' | 'light' | 'dark';

interface SettingsState {
  themeMode: ThemeMode;
  /** Require Face ID / fingerprint / device PIN when the app is opened or resumed. */
  biometricLock: boolean;
  /** Backend URL override. Only honoured in non-production builds (see services/api/baseUrl.ts). */
  serverUrl: string | null;
  setThemeMode: (mode: ThemeMode) => void;
  setBiometricLock: (enabled: boolean) => void;
  setServerUrl: (url: string | null) => void;
  reset: () => void;
}

const defaults = { themeMode: 'system' as ThemeMode, biometricLock: false, serverUrl: null as string | null };

const stateStorage: StateStorage = {
  getItem: (name) => mmkvStorage.getString(name) ?? null,
  setItem: (name, value) => mmkvStorage.set(name, value),
  removeItem: (name) => mmkvStorage.remove(name),
};

// Device-level preferences only (theme, biometric lock). Nothing sensitive is
// persisted here: tokens live in the Keychain/Keystore (see secureStorage.ts).
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setThemeMode: (themeMode) => set({ themeMode }),
      setBiometricLock: (biometricLock) => set({ biometricLock }),
      setServerUrl: (serverUrl) => set({ serverUrl }),
      reset: () => set(defaults),
    }),
    { name: 'settings', storage: createJSONStorage(() => stateStorage) },
  ),
);
