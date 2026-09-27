import { existsSync } from 'node:fs';
import type { ExpoConfig } from 'expo/config';

// APP_ENV is set per build profile in eas.json: development | preview | production.
const appEnv = process.env.APP_ENV ?? 'development';
const isProduction = appEnv === 'production';

// Firebase config for Android push (FCM). Not committed - download
// google-services.json from Firebase console > Project settings > Your apps,
// or point GOOGLE_SERVICES_FILE at it (on EAS: a file-type secret). The build
// still works without it; the app just cannot receive push on Android.
const googleServicesFile =
  process.env.GOOGLE_SERVICES_FILE ?? (existsSync('./google-services.json') ? './google-services.json' : undefined);

const config: ExpoConfig = {
  name: isProduction ? 'Navigator CRM' : `Navigator CRM (${appEnv})`,
  slug: 'navigator-crm',
  scheme: 'navigatorcrm',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.globalnavigator.crm',
    supportsTablet: false,
    // Only standard TLS/AES from the OS is used, which is exempt from export-compliance
    // paperwork; declaring it skips the questionnaire on every TestFlight upload.
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'com.globalnavigator.crm',
    googleServicesFile,
    // The app caches client PII (encrypted, but the keys are device-bound). Don't let it
    // ride into Google cloud backups or device-to-device transfers.
    allowBackup: false,
    // Least privilege: nothing here reads shared storage or draws over other apps. The
    // overlay permission is only needed by the dev menu, so it is kept in non-production builds.
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      ...(isProduction ? ['android.permission.SYSTEM_ALERT_WINDOW'] : []),
    ],
    adaptiveIcon: {
      backgroundColor: '#FDF3EC',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-secure-store',
    // The offline cache holds client PII, so the database is encrypted with
    // SQLCipher; the key lives in the Keychain/Keystore (src/services/db).
    ['expo-sqlite', { useSQLCipher: true }],
    [
      'expo-local-authentication',
      { faceIDPermission: 'Allow Navigator CRM to use Face ID to unlock the app and to confirm approvals.' },
    ],
    [
      'expo-notifications',
      {
        color: '#1F3B63',
        defaultChannel: 'default',
        // Selects the APNs entitlement: development builds talk to the APNs sandbox.
        mode: isProduction || appEnv === 'preview' ? 'production' : 'development',
      },
    ],
    [
      'expo-build-properties',
      {
        // Local/LAN dev servers are plain http; production is https only.
        android: { usesCleartextTraffic: !isProduction },
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 200,
        backgroundColor: '#FDF3EC',
        dark: { image: './assets/splash-icon-dark.png', backgroundColor: '#14273F' },
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Navigator CRM to access your photos to attach proof of payment or client documents.',
        cameraPermission: 'Allow Navigator CRM to use the camera to photograph proof of payment or client documents.',
      },
    ],
  ],
  extra: {
    appEnv,
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
};

export default config;
