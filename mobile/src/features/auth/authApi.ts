import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { api } from '@/services/api/client';
import type { LoginResult, TokenBundle } from './types';

const deviceInfo = () => ({
  deviceName: Device.deviceName ?? Device.modelName ?? undefined,
  platform: Platform.OS === 'ios' ? 'ios' : 'android',
});

interface LoginResponse extends Partial<TokenBundle> {
  mfaRequired?: boolean;
  mfaToken?: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const response = await api.post<LoginResponse>(
    '/api/mobile/auth/login',
    { username, password, ...deviceInfo() },
    { auth: false },
  );
  if (response.mfaRequired && response.mfaToken) return { kind: 'mfa', mfaToken: response.mfaToken };
  return { kind: 'success', bundle: response as TokenBundle };
}

export function verifyMfa(mfaToken: string, code: string): Promise<TokenBundle> {
  return api.post<TokenBundle>('/api/mobile/auth/verify-mfa', { mfaToken, code, ...deviceInfo() }, { auth: false });
}

export function refreshTokens(refreshToken: string): Promise<TokenBundle> {
  return api.post<TokenBundle>('/api/mobile/auth/refresh', { refreshToken, ...deviceInfo() }, { auth: false });
}

/** Best effort: revokes the server session and deactivates this device's push token. */
export function logoutRequest(refreshToken: string, pushToken?: string | null): Promise<unknown> {
  return api.post('/api/mobile/auth/logout', { refreshToken, pushToken: pushToken ?? undefined }, { auth: false, timeoutMs: 5000 });
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ message?: string }> {
  return api.post('/api/profile/change-password', { currentPassword, newPassword });
}

export interface MobileConfig {
  minAppVersion: string;
  latestAppVersion: string;
  maintenance: boolean;
  maintenanceMessage: string | null;
}

export function fetchMobileConfig(): Promise<MobileConfig> {
  return api.get<MobileConfig>('/api/mobile/config', { auth: false, timeoutMs: 8000 });
}
