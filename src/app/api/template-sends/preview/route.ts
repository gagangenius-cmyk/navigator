import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { buildSendValues } from '@/lib/templateSend/values';
import { getSendableTemplate, TemplateSendError } from '@/lib/templateSend/jobs';
import { resolveRecipients, summarize, MAX_LEADS_PER_SEND, type SenderMode } from '@/lib/templateSend/recipients';
import { renderEmail, templateVariables, type EmailVersionContent } from '@/lib/templateSend/render';

let dbReady = false;
const ensureDb = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

/**
 * POST /api/template-sends/preview  { templateId, leadIds, senderMode }
 * Dry run: who would receive it, who is skipped and why, and the email rendered for the first
 * sendable lead. Nothing is queued or sent.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const body = await request.json().catch(() => ({})) as { templateId?: number; leadIds?: number[]; senderMode?: SenderMode };
    const leadIds = Array.isArray(body.leadIds) ? body.leadIds : [];
    if (!leadIds.length) return NextResponse.json({ success: false, error: 'Select at least one lead' }, { status: 400 });
    if (leadIds.length > MAX_LEADS_PER_SEND) return NextResponse.json({ success: false, error: `You can send to at most ${MAX_LEADS_PER_SEND} leads at a time` }, { status: 422 });

    const { template, version } = await getSendableTemplate(auth, Number(body.templateId));
    const recipients = await resolveRecipients(auth, leadIds, body.senderMode === 'owner' ? 'owner' : 'me');
    const summary = summarize(recipients);

    const content: EmailVersionContent = { components: version.components as EmailVersionContent['components'], exportHtml: version.exportHtml, exportText: version.exportText };
    const sample = recipients.find((r) => !r.skipReason);
    let rendered = null;
    if (sample && sample.senderEmployeeId) {
      const values = await buildSendValues(sample.leadId, sample.senderEmployeeId);
      const r = renderEmail(content, values);
      rendered = { ...r, leadName: sample.leadName, to: sample.toEmail, from: sample.senderEmail };
    }

    return NextResponse.json({
      success: true,
      template: { id: template.id, name: template.name },
      variables: templateVariables(content),
      ...summary,
      skippedLeads: recipients.filter((r) => r.skipReason).slice(0, 50).map((r) => ({ leadId: r.leadId, leadName: r.leadName, reason: r.skipReason })),
      rendered,
    });
  } catch (error) {
    if (error instanceof TemplateSendError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('Template send preview failed:', error);
    return NextResponse.json({ success: false, error: 'Preview failed' }, { status: 500 });
  }
}
