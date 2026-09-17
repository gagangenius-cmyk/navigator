import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { generateText, isAnthropicConfigured } from '@/lib/anthropic';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rateLimiter';
import { captureError } from '@/lib/errorTracking';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

type RouteContext = { params: Promise<{ id: string }> };

// Drafts a suggested remark/follow-up note from a lead's recent activity
// history (crm_remarks - the same table src/app/api/leads/route.ts's
// "Today's Activity" tab reads). A starting point for the counselor to
// edit, not an auto-filed remark - this only ever returns text; nothing
// here writes to the lead.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = requireAuth(request, ['leads.update']);
  if (isAuthError(auth)) return auth;

  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 503 });
  }

  try {
    const { id } = await params;
    const leadId = Number.parseInt(id, 10);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: 'Valid lead id is required' }, { status: 400 });
    }

    // Throttle by actor id - an LLM call has real per-request cost, unlike
    // most other routes in this app.
    const rateLimitKey = `suggest-remark:${auth.id}`;
    const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 20 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many suggestion requests in a short time. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

    await ensureDB();
    const [lead] = await sequelize.query<{
      fname: string; lname: string; status: string | null; country_interest: string | null;
      service_interest: string | null; priority: string | null;
    }>(
      `SELECT fname, lname, status, country_interest, service_interest, priority
       FROM crm_forum_leads WHERE id = :leadId LIMIT 1`,
      { replacements: { leadId }, type: QueryTypes.SELECT }
    );
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const history = await sequelize.query<{ action: string; remark: string; created_at: string }>(
      `SELECT action, remark, created_at FROM crm_remarks
       WHERE lead_id = :leadId ORDER BY id DESC LIMIT 10`,
      { replacements: { leadId }, type: QueryTypes.SELECT }
    );

    const historyText = history.length
      ? history.reverse().map((h) => `- [${h.action}] ${h.remark}`).join('\n')
      : '(no prior activity recorded)';

    const leadName = [lead.fname, lead.lname].filter(Boolean).join(' ') || `Lead #${leadId}`;
    const prompt = `You are helping an immigration consultancy counsellor draft a short internal remark/follow-up note for a lead's CRM record, based on their recent activity history below.

Lead: ${leadName}
Status: ${lead.status || 'unknown'}
Country of interest: ${lead.country_interest || 'unspecified'}
Service/program of interest: ${lead.service_interest || 'unspecified'}
Priority: ${lead.priority || 'unspecified'}

Recent activity (oldest to newest):
${historyText}

Draft one short, professional remark (2-3 sentences max) a counsellor could log right now, summarizing where things stand and a concrete next step. Write only the remark text itself - no preamble, no quotes, no markdown.`;

    let suggestion: string;
    try {
      suggestion = await generateText({ prompt, maxTokens: 200 });
    } catch (error) {
      captureError(error, { route: 'POST /api/leads/[id]/suggest-remark', userId: auth.id });
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate a suggestion' }, { status: 502 });
    }

    return NextResponse.json({ suggestion: suggestion.trim() });
  } catch (error) {
    console.error('Error generating remark suggestion:', error);
    captureError(error, { route: 'POST /api/leads/[id]/suggest-remark' });
    return NextResponse.json({ error: 'Failed to generate a suggestion' }, { status: 500 });
  }
}
