import { cronSecretMatches } from '@/lib/cronAuth';
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/sequelize';
import { processTransferNotices } from '@/lib/leadTransferNotices';

export const maxDuration = 60;

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

/**
 * GET|POST /api/cron/lead-transfer-emails
 * Sends the "leads transferred to you" emails: everything moved to one counselor by one person is
 * clubbed into a single email. Runs every minute from vercel.json. Protected with
 * `Authorization: Bearer <CRON_SECRET>`; fails closed when CRON_SECRET is not configured.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/lead-transfer-emails] CRON_SECRET is not configured');
    return new NextResponse('Server misconfiguration', { status: 500 });
  }
  const auth = request.headers.get('authorization') || '';
  if (!cronSecretMatches(auth, secret)) return new NextResponse('Unauthorized', { status: 401 });

  await ensureDB();
  const result = await processTransferNotices();
  console.log(`[Cron] lead-transfer-emails: emails=${result.emails} leads=${result.leads} skipped=${result.skipped} failed=${result.failed}`);
  return NextResponse.json({ success: true, ...result });
}

export { POST as GET };
