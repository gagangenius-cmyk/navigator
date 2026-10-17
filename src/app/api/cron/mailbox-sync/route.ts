import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/sequelize';
import { syncAllMailboxes, purgeOldTrash } from '@/lib/mailboxes';

export const maxDuration = 300;

/**
 * POST /api/cron/mailbox-sync
 * Pulls new inbox mail for every active counselor mailbox. Run every few
 * minutes; protect with CRON_SECRET:
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // Fail closed: an unset CRON_SECRET must not leave this endpoint open.
  if (!secret) {
    console.error('[cron/mailbox-sync] CRON_SECRET is not configured');
    return new NextResponse('Server misconfiguration', { status: 500 });
  }
  if ((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') !== secret) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  await connectDB();
  const sync = await syncAllMailboxes();
  // Cheap indexed delete; runs on every sweep so retention is enforced without a second job.
  const trash = await purgeOldTrash().catch(() => ({ purged: 0, retentionDays: 0 }));
  return NextResponse.json({ success: true, ...sync, trash });
}
