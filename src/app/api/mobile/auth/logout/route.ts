import { NextRequest } from 'next/server';
import { revokeMobileSessionByToken } from '@/lib/mobileAuth';
import { unregisterMobileDevice } from '@/lib/mobileDevices';
import { mobileJson, readJsonObject, stringField } from '@/lib/mobileApi';

// Ends this device's session. Deliberately unauthenticated by access token -
// a logout must still work once the access token has expired - and idempotent:
// the refresh token itself is the credential, and an unknown one is a no-op.
// If the app also sends its push token, it is deactivated for that employee so
// the phone stops receiving their notifications immediately.
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  const refreshToken = body ? stringField(body, 'refreshToken', 256) : '';
  const pushToken = body ? stringField(body, 'pushToken', 512) : '';

  try {
    if (refreshToken) {
      const employeeId = await revokeMobileSessionByToken(refreshToken);
      if (employeeId && pushToken) await unregisterMobileDevice(employeeId, pushToken);
    }
  } catch (error) {
    console.error('Mobile logout error:', error);
  }
  return mobileJson({ success: true });
}
