import { NextRequest } from 'next/server';
import { buildAuthSessionForEmployeeId, verifyMfaPendingToken } from '@/lib/auth';
import { verifyLoginCode } from '@/lib/mfa';
import { checkRateLimit, clearRateLimit, getClientIp, recordFailedAttempt } from '@/lib/rateLimiter';
import { issueMobileSession } from '@/lib/mobileAuth';
import { mobileError, mobileJson, readJsonObject, sessionMeta, stringField } from '@/lib/mobileApi';
import { captureError } from '@/lib/errorTracking';

// Second step of mobile login for MFA-enrolled employees. Body-based twin of
// POST /api/auth/verify-mfa, which reads its pending token from a cookie.
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonObject(request);
    const mfaToken = body ? stringField(body, 'mfaToken', 2048) : '';
    const code = body ? stringField(body, 'code', 32) : '';
    if (!body || !mfaToken || !code) {
      return mobileError('Verification code is required', 400, 'missing_code');
    }

    const employeeId = verifyMfaPendingToken(mfaToken);
    if (!employeeId) {
      return mobileError('This login attempt has expired. Please sign in again.', 401, 'mfa_expired');
    }

    const rateLimitKey = `mobile-mfa:${getClientIp(request)}:${employeeId}`;
    const rateLimit = checkRateLimit(rateLimitKey, { maxAttempts: 8, windowMs: 15 * 60 * 1000 });
    if (!rateLimit.allowed) {
      return mobileError('Too many attempts. Please try again in a few minutes.', 429, 'rate_limited', {
        'Retry-After': String(rateLimit.retryAfterSeconds),
      });
    }

    if (!(await verifyLoginCode(employeeId, code))) {
      recordFailedAttempt(rateLimitKey);
      return mobileError('Invalid verification code', 401, 'invalid_code');
    }
    clearRateLimit(rateLimitKey);

    const authUser = await buildAuthSessionForEmployeeId(employeeId);
    if (!authUser) return mobileError('Account is no longer active', 401, 'account_inactive');

    const bundle = await issueMobileSession(authUser, sessionMeta(request, body));
    return mobileJson(bundle);
  } catch (error) {
    console.error('Mobile MFA verification error:', error);
    captureError(error, { route: 'POST /api/mobile/auth/verify-mfa' });
    return mobileError('Internal server error', 500, 'server_error');
  }
}
