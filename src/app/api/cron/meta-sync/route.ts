import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/sequelize';
import { runMetaAutoSync } from '@/lib/meta/sync';

// Full sync (campaigns, forms + auto-mapping, missed-lead backfill) can take a while
export const maxDuration = 300;

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

/**
 * GET|POST /api/cron/meta-sync
 * Schedule every 15-30 minutes (Vercel Cron sends "Authorization: Bearer $CRON_SECRET"
 * automatically when CRON_SECRET is set). On a long-running server the in-process
 * scheduler (src/lib/meta-sync-cron.ts) does the same job and this route is optional.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/meta-sync] CRON_SECRET is not configured');
    return new NextResponse('Server misconfiguration', { status: 500 });
  }
  const auth = request.headers.get('authorization') || '';
  if (auth.replace(/^Bearer\s+/i, '') !== secret) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  await ensureDB();
  const summary = await runMetaAutoSync();
  return NextResponse.json(summary, { status: summary.ok || summary.skipped ? 200 : 502 });
}

export { POST as GET };
