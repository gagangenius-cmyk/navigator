import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isAnthropicConfigured } from '@/lib/anthropic';
import { checkDuplicatesWithAI } from '@/lib/duplicateAiCheck';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rateLimiter';
import { captureError } from '@/lib/errorTracking';
import type { FuzzyDuplicateMatch } from '@/lib/duplicateLeadCheck';

// On-demand wrapper over checkDuplicatesWithAI() (src/lib/duplicateAiCheck.ts) -
// the main integration is a fire-and-forget hook inside POST /api/leads
// itself (see checkDuplicatesWithAIInBackground), which logs its verdict
// onto the matched lead's activity history rather than returning it to a
// page that's about to navigate away. This route exists for callers that
// want the verdict synchronously instead (e.g. a future duplicate-review UI).
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['leads.create', 'leads.update']);
  if (isAuthError(auth)) return auth;

  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 503 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const newLead = body.newLead || {};
    const candidates: FuzzyDuplicateMatch[] = Array.isArray(body.candidates) ? body.candidates.slice(0, 5) : [];

    if (!candidates.length) {
      return NextResponse.json({ verdicts: [] });
    }

    const rateLimitKey = `check-duplicate-ai:${auth.id}`;
    const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 30 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many duplicate checks in a short time. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

    const verdicts = await checkDuplicatesWithAI(newLead, candidates);
    return NextResponse.json({ verdicts });
  } catch (error) {
    console.error('Error running AI duplicate check:', error);
    captureError(error, { route: 'POST /api/leads/check-duplicate-ai' });
    return NextResponse.json({ error: 'Failed to check for duplicates' }, { status: 500 });
  }
}
