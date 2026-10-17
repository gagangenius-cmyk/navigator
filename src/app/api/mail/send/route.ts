import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { getMailboxForEmployee, sendFromMailbox, MAX_ATTACHMENT_BYTES, type OutgoingAttachment } from '@/lib/mailboxes';

// Always sends from the CALLER's own mailbox - nobody (CEO included) can
// send as another counselor. Accepts multipart/form-data so files can ride
// along (4 MB total, the serverless request-body ceiling).
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  try {
    const mailbox = await getMailboxForEmployee(auth.id);
    if (!mailbox) return NextResponse.json({ error: 'No mailbox is connected to your account. Ask the CEO to connect one.' }, { status: 409 });
    const form = await request.formData();
    const subject = String(form.get('subject') || '').trim();
    const body = String(form.get('body') || '').trim();
    if (!subject || !body) return NextResponse.json({ error: 'Subject and message are required' }, { status: 422 });

    const attachments: OutgoingAttachment[] = [];
    let total = 0;
    for (const entry of form.getAll('files')) {
      if (typeof entry === 'string') continue;
      total += entry.size;
      if (total > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: 'Attachments are too large (4 MB total limit)' }, { status: 413 });
      attachments.push({ filename: entry.name || 'attachment', content: Buffer.from(await entry.arrayBuffer()), contentType: entry.type || undefined });
    }
    const result = await sendFromMailbox(mailbox, {
      to: String(form.get('to') || ''),
      cc: String(form.get('cc') || ''),
      bcc: String(form.get('bcc') || ''),
      subject,
      body,
      inReplyTo: form.get('inReplyTo') ? String(form.get('inReplyTo')) : null,
      leadId: form.get('leadId') ? Number(form.get('leadId')) : null,
      attachments,
    });
    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to send email' }, { status: 422 });
  }
}
