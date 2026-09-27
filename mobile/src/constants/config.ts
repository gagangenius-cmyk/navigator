import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type AppEnv = 'development' | 'preview' | 'production';

const rawEnv = process.env.EXPO_PUBLIC_APP_ENV;
export const APP_ENV: AppEnv = rawEnv === 'production' || rawEnv === 'preview' ? rawEnv : 'development';
export const IS_PRODUCTION = APP_ENV === 'production';

/**
 * Internal (development / preview) builds let the tester point the app at another server from the
 * login screen, so one APK works against local, staging and production. Production builds never do:
 * a store build must not be redirectable to an arbitrary server.
 */
export const ALLOW_SERVER_OVERRIDE = !IS_PRODUCTION;

/**
 * Default backend base URL, no trailing slash. Inlined at build time from EXPO_PUBLIC_API_URL.
 * Use getApiBaseUrl() (services/api/baseUrl.ts) - it also honours the runtime override.
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export const APP_VERSION = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0';
export const APP_BUILD = Application.nativeBuildVersion ?? '0';

/** Which APNs endpoint this build's push tokens belong to (dev-client builds use the sandbox). */
export const APNS_ENVIRONMENT: 'sandbox' | 'production' = APP_ENV === 'development' ? 'sandbox' : 'production';

export const REQUEST_TIMEOUT_MS = 20_000;
export const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;

export const IS_IOS = Platform.OS === 'ios';
