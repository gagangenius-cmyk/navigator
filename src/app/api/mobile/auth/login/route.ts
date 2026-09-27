import { NextRequest } from 'next/server';
import { authenticateUser, generateMfaPendingToken } from '@/lib/auth';
import { checkRateLimit, clearRateLimit, getClientIp, recordFailedAttempt } from '@/lib/rateLimiter';
import { isMfaEnabled } from '@/lib/mfa';
import { issueMobileSession } from '@/lib/mobileAuth';
import { mobileError, mobileJson, readJsonObject, sessionMeta, stringField } from '@/lib/mobileApi';
import { captureError } from '@/lib/errorTracking';

// Mobile twin of POST /api/auth/login. Same credential check, rate limit and
// MFA rules - but tokens come back in the JSON body (a native app can't read
// the web's httpOnly cookie) and the session is a short access token plus a
// rotating refresh token (src/lib/mobileAuth.ts).
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const username = body ? stringField(body, 'username', 255).toLowerCase() : '';
    const password = body && typeof body.password === 'string' ? body.password : '';
    if (!body || !username || !password) {
      return mobileError('Username and password are required', 400, 'missing_credentials');
    }

    const rateLimitKey = `mobile:${getClientIp(request)}:${username}`;
    const rateLimit = checkRateLimit(rateLimitKey);
    if (!rateLimit.allowed) {
      return mobileError('Too many login attempts. Please try again in a few minutes.', 429, 'rate_limited', {
        'Retry-After': String(rateLimit.retryAfterSeconds),
      });
    }

    const authUser = await authenticateUser(username, password);
    if (!authUser) {
      recordFailedAttempt(rateLimitKey);
      return mobileError('Invalid username or password', 401, 'invalid_credentials');
    }
    clearRateLimit(rateLimitKey);

    // MFA-enrolled employees get only a 5-minute pending token here; the app
    // trades it plus a TOTP code for the real session at /auth/verify-mfa.
    if (await isMfaEnabled(authUser.id).catch(() => false)) {
      return mobileJson({ mfaRequired: true, mfaToken: generateMfaPendingToken(authUser.id) });
    }

    const bundle = await issueMobileSession(authUser, sessionMeta(request, body));
    return mobileJson(bundle);
  } catch (error) {
    console.error('Mobile login error:', error);
    captureError(error, { route: 'POST /api/mobile/auth/login' });
    return mobileError('Internal server error', 500, 'server_error');
  }
}
