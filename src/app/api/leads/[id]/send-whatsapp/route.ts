import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { logLeadRemark } from '@/lib/leadRemarks';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rateLimiter';
import { captureError } from '@/lib/errorTracking';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

type RouteContext = { params: Promise<{ id: string }> };

// Sends an actual WhatsApp message via the Meta Cloud API (src/lib/whatsapp.ts) -
// distinct from the existing wa.me click-to-chat link in LeadManagement.tsx,
// which just opens the counselor's own WhatsApp app/web session with a
// prefilled draft. This sends and tracks delivery from the CRM itself.
export async function POST(request: NextRequest, { params }: RouteContext) {
  const auth = requireAuth(request, ['leads.update']);
  if (isAuthError(auth)) return auth;
  try {
    const { id } = await params;
    const leadId = Number.parseInt(id, 10);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: 'Valid lead id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const message = String(body.message || '').trim();
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    // Throttle by actor id - an authenticated action, so the risk is a
    // compromised/scripted session mass-sending, not anonymous brute force.
    const rateLimitKey = `whatsapp-send:${auth.id}`;
    const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 30 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many WhatsApp messages sent in a short time. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }
    recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

    await ensureDB();
    const [lead] = await sequelize.query<{ id: number; whatsapp_number: string | null; mobile: string | null; phone: string | null }>(
      `SELECT id, whatsapp_number, mobile, phone FROM crm_forum_leads WHERE id = :leadId LIMIT 1`,
      { replacements: { leadId }, type: QueryTypes.SELECT }
    );
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const to = lead.whatsapp_number || lead.mobile || lead.phone;
    if (!to) {
      return NextResponse.json({ error: 'This lead has no phone number to send to' }, { status: 400 });
    }

    try {
      await sendWhatsAppMessage({ to, message, actorId: auth.id, leadId });
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : 'Failed to send WhatsApp message';
      captureError(error, { route: 'POST /api/leads/[id]/send-whatsapp', userId: auth.id });
      // Still a 200-shaped failure the caller can show inline (not a 500) -
      // sendWhatsAppMessage() already recorded it to crm_whatsapp_delivery_log.
      return NextResponse.json({ success: false, error: errMessage }, { status: 502 });
    }

    // Mirrors src/app/api/lead-remarks/route.ts's pattern: also a normal
    // remark row so it shows up in the lead's existing Remarks history
    // without needing new UI, in addition to the general activity log.
    const now = new Date();
    await sequelize.query(
      `INSERT INTO crm_forum_leads_remarks (\`lead\`, \`date\`, remark, emp, created)
       VALUES (:leadId, :date, :remark, :empId, :time)`,
      {
        replacements: {
          leadId,
          date: now.toISOString().split('T')[0],
          remark: `WhatsApp sent: ${message}`,
          empId: auth.id,
          time: now.toTimeString().split(' ')[0],
        },
      }
    );

    await logLeadRemark({
      leadId,
      action: 'whatsapp_sent',
      remark: `WhatsApp message sent to ${to}: ${message}`,
      actorId: auth.id,
      actorRole: auth.roleName || auth.type || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    captureError(error, { route: 'POST /api/leads/[id]/send-whatsapp' });
    return NextResponse.json({ error: 'Failed to send WhatsApp message' }, { status: 500 });
  }
}
