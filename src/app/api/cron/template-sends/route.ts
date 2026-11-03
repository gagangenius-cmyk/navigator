import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/sequelize';
import { processTemplateSends } from '@/lib/templateSend/processor';

export const maxDuration = 60;

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

/**
 * GET|POST /api/cron/template-sends
 * Sends queued "Send template" emails and releases scheduled ones. Runs every minute from
 * vercel.json. Protected with `Authorization: Bearer <CRON_SECRET>` and fails closed when
 * CRON_SECRET is not configured.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/template-sends] CRON_SECRET is not configured');
    return new NextResponse('Server misconfiguration', { status: 500 });
  }
  const auth = request.headers.get('authorization') || '';
  if (auth.replace(/^Bearer\s+/i, '') !== secret) return new NextResponse('Unauthorized', { status: 401 });

  await ensureDB();
  const result = await processTemplateSends({ timeBudgetMs: 45_000 });
  console.log(`[Cron] template-sends: sent=${result.sent} failed=${result.failed} skipped=${result.skipped} requeued=${result.requeued}`);
  return NextResponse.json({ success: true, ...result });
}

export { POST as GET };
