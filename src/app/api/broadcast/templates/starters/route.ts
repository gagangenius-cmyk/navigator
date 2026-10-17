import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { installStarterTemplates } from '@/lib/broadcastStarterTemplates';

// One-click install of the appointment / follow-up / payment-reminder starter
// email templates. Idempotent: templates that already exist (by name) are skipped.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['templates.manage']);
  if (isAuthError(auth)) return auth;
  try {
    await connectDB();
    const result = await installStarterTemplates({ id: auth.id, branch: auth.branch ?? null });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Failed to install starter templates:', error);
    return NextResponse.json({ success: false, error: 'Failed to install starter templates' }, { status: 500 });
  }
}
