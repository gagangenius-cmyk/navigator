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

// A second set of eyes for the compliance reviewer, not a decision-maker -
// this never approves/rejects anything, it only flags things worth a closer
// look before the human does. Deliberately doesn't touch the signed
// agreement document itself: those are commonly PDFs (accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
// on upload), and Claude's vision content blocks only reliably handle images,
// not the mixed format this field actually receives - so this reviews the
// structured data already on the approval record instead (payment amounts,
// signature presence, the counselor's own conversation summary), which is
// exactly what a compliance officer already manually cross-references today.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = requireAuth(request, ['agreements.view', 'documents.view']);
  if (isAuthError(auth)) return auth;

  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 503 });
  }

  try {
    const { id } = await params;
    const approvalId = Number.parseInt(id, 10);
    if (!Number.isFinite(approvalId)) {
      return NextResponse.json({ error: 'Valid approval id is required' }, { status: 400 });
    }

    const rateLimitKey = `compliance-ai-review:${auth.id}`;
    const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 30 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many AI reviews in a short time. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

    await ensureDB();
    const [approval] = await sequelize.query<{
      signedAgreementUrl: string | null;
      clientSignature: string | null;
      signatureDate: string | null;
      conversationSummary: string | null;
      clientCommitments: string | null;
      nextAction: string | null;
      receiptNumber: string | null;
      paidAmount: number | null;
      totalAmount: number | null;
      currency: string | null;
      accountantStatus: string | null;
      clientName: string | null;
      serviceType: string | null;
    }>(
      `SELECT
         a.signedAgreementUrl, a.clientSignature, a.signatureDate,
         h.conversation_summary AS conversationSummary, h.client_commitments AS clientCommitments, h.next_action AS nextAction,
         COALESCE(p.receiptNumber, p.paymentNumber) AS receiptNumber, p.paidAmount, p.totalAmount, p.currency, p.accountantStatus,
         CONCAT(COALESCE(l.fname, ''), ' ', COALESCE(l.lname, '')) AS clientName,
         COALESCE(o.serviceType, o.serviceRequired) AS serviceType
       FROM crm_opportunity_compliance_approvals a
       LEFT JOIN crm_forum_leads l ON l.id = a.leadId
       LEFT JOIN crm_opportunities o ON o.id = a.opportunityId
       LEFT JOIN (
         SELECT n1.* FROM crm_opportunity_handover_notes n1
         INNER JOIN (SELECT lead_id, MAX(id) AS latestId FROM crm_opportunity_handover_notes GROUP BY lead_id) latest
           ON latest.latestId = n1.id
       ) h ON h.lead_id = a.leadId
       LEFT JOIN (
         SELECT p1.* FROM crm_opportunity_payments p1
         INNER JOIN (SELECT opportunityId, MAX(id) AS latestId FROM crm_opportunity_payments GROUP BY opportunityId) latest2
           ON latest2.latestId = p1.id
       ) p ON p.opportunityId = a.opportunityId
       WHERE a.id = :approvalId
       LIMIT 1`,
      { replacements: { approvalId }, type: QueryTypes.SELECT }
    );

    if (!approval) {
      return NextResponse.json({ error: 'Compliance approval not found' }, { status: 404 });
    }

    const prompt = `You are assisting a compliance officer at an immigration consultancy reviewing a signed client agreement before approving it. Look at this record for anything inconsistent or worth double-checking - you cannot see the actual signed document image, only the data recorded about it.

Client: ${approval.clientName?.trim() || 'unknown'}
Service: ${approval.serviceType || 'unspecified'}
Signed agreement uploaded: ${approval.signedAgreementUrl ? 'yes' : 'NO - missing'}
Client signature recorded: ${approval.clientSignature || 'NO - missing'}
Signature date: ${approval.signatureDate || 'NO - missing'}
Receipt/payment number: ${approval.receiptNumber || 'NO - missing'}
Paid amount: ${approval.paidAmount ?? 'unknown'} ${approval.currency || ''}
Total agreed amount: ${approval.totalAmount ?? 'unknown'} ${approval.currency || ''}
Accountant verification status: ${approval.accountantStatus || 'not verified'}
Counsellor's conversation summary: ${approval.conversationSummary || '(none recorded)'}
Client commitments noted: ${approval.clientCommitments || '(none recorded)'}
Next action noted: ${approval.nextAction || '(none recorded)'}

Respond with a short bulleted list (plain text, "- " prefix, max 5 bullets) of anything worth flagging - missing fields, a paid amount that doesn't match the total, a conversation summary that seems generic/templated or doesn't mention the service above, an unverified payment, etc. If nothing stands out, respond with exactly: "No concerns found." Do not repeat information back that isn't actually a concern.`;

    let review: string;
    try {
      review = await generateText({ prompt, maxTokens: 300 });
    } catch (error) {
      captureError(error, { route: 'POST /api/opportunity-compliance-approvals/[id]/ai-review', userId: auth.id });
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate a review' }, { status: 502 });
    }

    return NextResponse.json({ review: review.trim() });
  } catch (error) {
    console.error('Error generating compliance AI review:', error);
    captureError(error, { route: 'POST /api/opportunity-compliance-approvals/[id]/ai-review' });
    return NextResponse.json({ error: 'Failed to generate a review' }, { status: 500 });
  }
}
