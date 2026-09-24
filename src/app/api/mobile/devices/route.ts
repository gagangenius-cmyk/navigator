import { NextRequest } from 'next/server';
import { isAuthError, requireAuth } from '@/lib/apiAuth';
import {
  isValidPushToken,
  parseEnvironment,
  parsePlatform,
  registerMobileDevice,
  unregisterMobileDevice,
} from '@/lib/mobileDevices';
import { mobileError, mobileJson, readJsonObject, stringField } from '@/lib/mobileApi';
import { captureError } from '@/lib/errorTracking';

// Push-token registry for the signed-in employee. The token is the native one
// from expo-notifications getDevicePushTokenAsync(): an FCM registration token
// on Android, a raw APNs device token on iOS. Registering an already-known
// token re-binds it to the caller, so a shared or handed-over phone never keeps
// pushing the previous user's notifications.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await readJsonObject(request);
    const platform = body ? parsePlatform(body.platform) : null;
    const token = body ? stringField(body, 'token', 512) : '';
    if (!body || !platform || !token) {
      return mobileError('token and platform (android | ios) are required', 400, 'invalid_device');
    }
    if (!isValidPushToken(platform, token)) {
      return mobileError(`token is not a valid ${platform === 'ios' ? 'APNs' : 'FCM'} token`, 422, 'invalid_token');
    }

    await registerMobileDevice(auth.id, {
      token,
      platform,
      environment: parseEnvironment(body.environment),
      deviceName: stringField(body, 'deviceName', 150) || null,
      appVersion: stringField(body, 'appVersion', 30) || null,
    });
    return mobileJson({ success: true }, 201);
  } catch (error) {
    console.error('Mobile device registration error:', error);
    captureError(error, { route: 'POST /api/mobile/devices' });
    return mobileError('Internal server error', 500, 'server_error');
  }
}

export async function DELETE(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;

  try {
    const body = await readJsonObject(request);
    const token = body ? stringField(body, 'token', 512) : '';
    if (!token) return mobileError('token is required', 400, 'invalid_device');

    await unregisterMobileDevice(auth.id, token);
    return mobileJson({ success: true });
  } catch (error) {
    console.error('Mobile device unregistration error:', error);
    captureError(error, { route: 'DELETE /api/mobile/devices' });
    return mobileError('Internal server error', 500, 'server_error');
  }
}
