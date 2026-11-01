import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { logAudit } from '@/lib/auditLog';
import { captureError } from '@/lib/errorTracking';
import { completeEmbeddedSignup, parseSignupInput, SignupError } from '@/lib/meta/whatsapp-signup';

const PERMISSIONS = ['marketing.manage'];

/**
 * GET /api/admin/meta-leads/whatsapp-signup
 * What the browser needs to launch Meta's Embedded Signup. The app id is public
 * by design (it is in every Facebook login URL); the app secret never leaves the server.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, PERMISSIONS);
  if (isAuthError(auth)) return auth;

  const appId = process.env.META_APP_ID || '';
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '';
  return NextResponse.json({
    configured: Boolean(appId && configId && process.env.META_APP_SECRET),
    appId,
    configId,
    graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v21.0',
    missing: [
      !appId && 'META_APP_ID',
      !process.env.META_APP_SECRET && 'META_APP_SECRET',
      !configId && 'META_EMBEDDED_SIGNUP_CONFIG_ID',
    ].filter(Boolean),
  });
}

/**
 * POST /api/admin/meta-leads/whatsapp-signup
 * Body: { code, wabaId, phoneNumberId? } from a finished Embedded Signup.
 * Subscribes our app to that WhatsApp account so its messages reach /api/webhooks/whatsapp.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, PERMISSIONS);
  if (isAuthError(auth)) return auth;

  try {
    const input = parseSignupInput(await request.json().catch(() => null));
    const result = await completeEmbeddedSignup(input);

    // Log that it happened - never the code or any token.
    void logAudit({
      entityType: 'meta_whatsapp',
      entityId: input.wabaId,
      action: 'embedded_signup',
      summary: `WhatsApp account ${input.wabaId} connected via Embedded Signup (${result.phones.length} number(s))`,
      actorId: auth.id,
      actorRole: auth.roleName,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof SignupError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    captureError(error, { route: 'POST /api/admin/meta-leads/whatsapp-signup' });
    return NextResponse.json({ success: false, error: 'WhatsApp connection failed' }, { status: 500 });
  }
}
