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

// Drafts an outbound, client-facing message (as opposed to
// /api/leads/[id]/suggest-remark, which drafts an internal note) - only
// wired into WhatsApp send today since that's the only outbound-to-client
// send surface this CRM actually has; extend the same prompt/route to an
// email compose UI if one gets built later rather than duplicating it.
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

    const body = await request.json().catch(() => ({}));
    const intent = typeof body.intent === 'string' ? body.intent.trim().slice(0, 300) : '';

    const rateLimitKey = `draft-message:${auth.id}`;
    const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 20 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many draft requests in a short time. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

    await ensureDB();
    const [lead] = await sequelize.query<{
      fname: string; lname: string; status: string | null; country_interest: string | null;
      service_interest: string | null;
    }>(
      `SELECT fname, lname, status, country_interest, service_interest FROM crm_forum_leads WHERE id = :leadId LIMIT 1`,
      { replacements: { leadId }, type: QueryTypes.SELECT }
    );
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const history = await sequelize.query<{ action: string; remark: string }>(
      `SELECT action, remark FROM crm_remarks WHERE lead_id = :leadId ORDER BY id DESC LIMIT 6`,
      { replacements: { leadId }, type: QueryTypes.SELECT }
    );
    const historyText = history.length
      ? history.reverse().map((h) => `- [${h.action}] ${h.remark}`).join('\n')
      : '(no prior activity recorded)';

    const leadName = [lead.fname, lead.lname].filter(Boolean).join(' ') || `this client`;
    const prompt = `Draft a short WhatsApp message from an immigration consultancy to a client. Write it as if sent directly to them - second person, friendly but professional, no salesy language.

Client: ${leadName}
Current status: ${lead.status || 'unknown'}
Service/program of interest: ${lead.service_interest || 'unspecified'}

Recent internal activity notes (context only - do not repeat these verbatim to the client):
${historyText}
${intent ? `\nWhat this message should say: ${intent}` : ''}

Write only the message text itself (2-4 sentences, WhatsApp-appropriate length) - no subject line, no signature, no quotes, no markdown.`;

    let draft: string;
    try {
      draft = await generateText({ prompt, maxTokens: 200 });
    } catch (error) {
      captureError(error, { route: 'POST /api/leads/[id]/draft-message', userId: auth.id });
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to draft a message' }, { status: 502 });
    }

    return NextResponse.json({ draft: draft.trim() });
  } catch (error) {
    console.error('Error drafting client message:', error);
    captureError(error, { route: 'POST /api/leads/[id]/draft-message' });
    return NextResponse.json({ error: 'Failed to draft a message' }, { status: 500 });
  }
}
