import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { canManageMailboxes, getMailboxById, testMailbox } from '@/lib/mailboxes';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  if (!canManageMailboxes(auth)) return NextResponse.json({ error: 'Only the CEO can manage mailboxes' }, { status: 403 });
  const { id } = await params;
  const mb = await getMailboxById(Number(id));
  if (!mb) return NextResponse.json({ error: 'Mailbox not found' }, { status: 404 });
  try {
    return NextResponse.json({ success: true, result: await testMailbox(mb) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Test failed' }, { status: 422 });
  }
}
