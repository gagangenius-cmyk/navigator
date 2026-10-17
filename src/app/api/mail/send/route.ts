import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { getMailboxForEmployee, sendFromMailbox } from '@/lib/mailboxes';

// Always sends from the CALLER's own mailbox - nobody (CEO included) can
// send as another counselor.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  try {
    const mailbox = await getMailboxForEmployee(auth.id);
    if (!mailbox) return NextResponse.json({ error: 'No mailbox is connected to your account. Ask the CEO to connect one.' }, { status: 409 });
    const b = await request.json();
    const subject = String(b.subject || '').trim();
    const body = String(b.body || '').trim();
    if (!subject || !body) return NextResponse.json({ error: 'Subject and message are required' }, { status: 422 });
    const result = await sendFromMailbox(mailbox, {
      to: String(b.to || ''),
      subject,
      body,
      inReplyTo: b.inReplyTo ? String(b.inReplyTo) : null,
      leadId: b.leadId ? Number(b.leadId) : null,
    });
    return NextResponse.json({ success: true, messageId: result.messageId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to send email' }, { status: 422 });
  }
}
