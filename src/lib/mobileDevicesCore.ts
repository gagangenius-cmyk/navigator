// Pure (no DB) validation for push-device registration - see mobileDevices.ts.

export type MobilePlatform = 'android' | 'ios';
export type ApnsEnvironment = 'sandbox' | 'production';

// APNs device tokens are hex (32 bytes today, up to 100 per Apple's docs).
// FCM registration tokens are ~163 URL-safe characters with a ':' separator.
const APNS_TOKEN = /^[0-9a-fA-F]{64,200}$/;
const FCM_TOKEN = /^[A-Za-z0-9_\-:.]{100,4096}$/;

export function isValidPushToken(platform: MobilePlatform, token: string): boolean {
  return platform === 'ios' ? APNS_TOKEN.test(token) : FCM_TOKEN.test(token);
}

export function parsePlatform(value: unknown): MobilePlatform | null {
  return value === 'android' || value === 'ios' ? value : null;
}

export function parseEnvironment(value: unknown): ApnsEnvironment | null {
  return value === 'sandbox' || value === 'production' ? value : null;
}
