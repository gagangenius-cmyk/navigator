import { NextRequest } from 'next/server';
import { rotateMobileSession } from '@/lib/mobileAuth';
import { mobileError, mobileJson, readJsonObject, sessionMeta, stringField } from '@/lib/mobileApi';
import { captureError } from '@/lib/errorTracking';

// Exchanges a refresh token for a new access + refresh pair. The refresh
// token is single-use: presenting one that was already rotated revokes the
// whole session (see decideRefresh in src/lib/mobileAuth.ts). The response
// carries a freshly-built user, so permission changes reach the app here.
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const refreshToken = body ? stringField(body, 'refreshToken', 256) : '';
    if (!body || !refreshToken) {
      return mobileError('Refresh token is required', 400, 'missing_refresh_token');
    }

    const result = await rotateMobileSession(refreshToken, sessionMeta(request, body));
    if (!result.ok) return mobileError(result.error, result.status, result.code);
    return mobileJson(result.bundle);
  } catch (error) {
    console.error('Mobile refresh error:', error);
    captureError(error, { route: 'POST /api/mobile/auth/refresh' });
    return mobileError('Internal server error', 500, 'server_error');
  }
}
