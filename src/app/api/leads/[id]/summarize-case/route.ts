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

// Drafts the "Counselor Conversation Summary" required at the Agreement
// stage of the Opportunity Flow wizard (opportunity-flow-wizard.tsx) - the
// handover note operations/compliance actually reads once a case leaves
// sales (crm_opportunity_handover_notes, via /api/opportunity-handover-notes).
// Uses more activity history than suggest-remark (20 rows vs 10) since a
// handover summary needs to cover the whole relationship, not just "what's
// the next note."
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

    const rateLimitKey = `summarize-case:${auth.id}`;
    const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 20 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many summary requests in a short time. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

    await ensureDB();
    const [lead] = await sequelize.query<{
      fname: string; lname: string; status: string | null; country_interest: string | null;
      service_interest: string | null; regdate: string | null;
    }>(
      `SELECT fname, lname, status, country_interest, service_interest, regdate
       FROM crm_forum_leads WHERE id = :leadId LIMIT 1`,
      { replacements: { leadId }, type: QueryTypes.SELECT }
    );
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const history = await sequelize.query<{ action: string; remark: string; created_at: string }>(
      `SELECT action, remark, created_at FROM crm_remarks WHERE lead_id = :leadId ORDER BY id ASC LIMIT 20`,
      { replacements: { leadId }, type: QueryTypes.SELECT }
    );

    if (!history.length) {
      return NextResponse.json({ error: 'No activity has been logged for this lead yet to summarize.' }, { status: 422 });
    }

    const historyText = history.map((h) => `- [${new Date(h.created_at).toISOString().slice(0, 10)}] [${h.action}] ${h.remark}`).join('\n');
    const leadName = [lead.fname, lead.lname].filter(Boolean).join(' ') || `Lead #${leadId}`;

    const prompt = `You are helping a sales counsellor at an immigration consultancy hand off a case to operations/compliance. Draft the "Counselor Conversation Summary" they need to submit - this is what operations reads to understand the case before taking it over, so it should cover the substance of the relationship, not just the most recent note.

Client: ${leadName}
Service/program: ${lead.service_interest || 'unspecified'}
Country of interest: ${lead.country_interest || 'unspecified'}
Lead since: ${lead.regdate || 'unknown'}

Full activity history (oldest to newest):
${historyText}

Write a clear paragraph (4-6 sentences) covering: what the client needs/has expressed interest in, what's been discussed or committed to so far, and the current state of the case. Write only the summary text itself - no preamble, no headers, no markdown.`;

    let summary: string;
    try {
      summary = await generateText({ prompt, maxTokens: 400 });
    } catch (error) {
      captureError(error, { route: 'POST /api/leads/[id]/summarize-case', userId: auth.id });
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate a summary' }, { status: 502 });
    }

    return NextResponse.json({ summary: summary.trim() });
  } catch (error) {
    console.error('Error generating case summary:', error);
    captureError(error, { route: 'POST /api/leads/[id]/summarize-case' });
    return NextResponse.json({ error: 'Failed to generate a summary' }, { status: 500 });
  }
}
