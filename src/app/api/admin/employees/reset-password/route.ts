import { NextRequest, NextResponse } from 'next/server';
import { HRService } from '@/services/hr-service';
import { connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { captureError } from '@/lib/errorTracking';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rateLimiter';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

// HR-triggered reset (not the employee's own change-password flow): generates a new
// random password, forces a change on next login, and best-effort emails it to the
// employee's company inbox. Returns the plaintext password once so HR isn't stuck if
// the mailer isn't configured - never persisted or logged anywhere.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['employees.manage', 'hr.update']);
  if (isAuthError(auth)) return auth;
  try {
    // Throttle by the admin's own id, not IP - this is an authenticated
    // action, so the risk is a compromised/malicious admin session scripting
    // resets across many accounts, not an anonymous brute force.
    const rateLimitKey = `employee-reset-password:${auth.id}`;
    const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 20 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many password resets. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

    await ensureDB();
    const body = await request.json();
    const id = Number.parseInt(String(body.id || ''), 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Valid employee id is required' }, { status: 400 });
    }

    const result = await HRService.resetEmployeePassword(id);

    await logAudit({
      entityType: 'employee',
      entityId: id,
      action: 'password_reset',
      summary: `Password reset for employee #${id} by admin`,
      actorId: auth.id,
      actorRole: auth.roleName || auth.type || null,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to reset password';
    console.error('Error resetting employee password:', error);
    captureError(error, { route: 'POST /api/admin/employees/reset-password' });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
