import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { canManageMailboxes, getMailboxById, getMailboxForEmployee, syncMailbox } from '@/lib/mailboxes';

export const maxDuration = 60;

// Pull new inbox mail on demand ("Refresh"). The CEO can also sync any
// counselor's mailbox by passing mailboxId.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  try {
    const body = await request.json().catch(() => ({}));
    const requestedId = Number(body?.mailboxId || 0);
    const mailbox = requestedId && canManageMailboxes(auth) ? await getMailboxById(requestedId) : await getMailboxForEmployee(auth.id);
    if (!mailbox) return NextResponse.json({ error: 'No mailbox is connected to your account' }, { status: 409 });
    const result = await syncMailbox(mailbox);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sync failed' }, { status: 502 });
  }
}
