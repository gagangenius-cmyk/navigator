import { cronSecretMatches } from '@/lib/cronAuth';
import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/sequelize';
import { withCronRunLog } from '@/lib/cronRunLog';
import { processDueJobs } from '@/lib/jobQueue';
import { registerBuiltInJobHandlers } from '@/lib/job-queue-cron';
import { runSlaSweep } from '@/lib/leadPool';
import { getAssignmentSettings } from '@/lib/assignmentSettings';
import { runStaleLeadRecycleSweep } from '@/lib/staleLeadRecycle';
import { refreshLeadScores } from '@/lib/leadScore';
import { runContractReconciliation } from '@/lib/contractReconciliation';
import { RenewalReminderService } from '@/services/renewal-reminder-service';

export const maxDuration = 60;

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

/**
 * GET|POST /api/cron/background-jobs?job=<name>
 *
 * HTTP entry point for the background jobs that src/instrumentation.ts only
 * schedules in-process with node-cron. That works under `next start`/Docker,
 * but on Vercel's serverless functions nothing keeps running between requests,
 * so these never fired (queued emails - password resets, monthly reports,
 * client portal - sat unsent in the job queue). vercel.json calls this once per
 * job on the same cadence the in-process crons use. Each job keeps the same
 * name in withCronRunLog (System Jobs page) and honours the same *_CRON_ENABLED
 * kill switch.
 *
 * Protected with `Authorization: Bearer <CRON_SECRET>`; fails closed when
 * CRON_SECRET is not configured.
 */
const JOBS: Record<string, { envFlag: string; run: () => Promise<unknown> }> = {
  'job-queue': {
    envFlag: 'JOB_QUEUE_CRON_ENABLED',
    run: () => {
      registerBuiltInJobHandlers();
      return withCronRunLog('job_queue_processor', () => processDueJobs());
    },
  },
  'lead-pool-sla': {
    envFlag: 'LEAD_POOL_SLA_CRON_ENABLED',
    run: () => withCronRunLog('lead_pool_sla_sweep', async () => {
      const settings = await getAssignmentSettings();
      if (!settings.slaSweepEnabled) return { skipped: true, reason: 'disabled_by_admin' } as const;
      return runSlaSweep();
    }),
  },
  'stale-lead-recycle': {
    envFlag: 'STALE_LEAD_RECYCLE_CRON_ENABLED',
    run: () => withCronRunLog('stale_lead_recycle_sweep', () => runStaleLeadRecycleSweep()),
  },
  'lead-score': {
    envFlag: 'LEAD_SCORE_CRON_ENABLED',
    run: () => withCronRunLog('lead_score_refresh', () => refreshLeadScores()),
  },
  'contract-reconciliation': {
    envFlag: 'CONTRACT_RECONCILIATION_CRON_ENABLED',
    run: () => withCronRunLog('contract_reconciliation', () => runContractReconciliation()),
  },
  'renewal-reminder': {
    envFlag: 'RENEWAL_REMINDER_CRON_ENABLED',
    run: () => withCronRunLog('renewal_reminder_scan', () => RenewalReminderService.runDailyReminderScan()),
  },
};

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/background-jobs] CRON_SECRET is not configured');
    return new NextResponse('Server misconfiguration', { status: 500 });
  }
  if (!cronSecretMatches(request.headers.get('authorization'), secret)) return new NextResponse('Unauthorized', { status: 401 });

  const jobName = request.nextUrl.searchParams.get('job') || '';
  const job = JOBS[jobName];
  if (!job) {
    return NextResponse.json({ error: `Unknown job. Use one of: ${Object.keys(JOBS).join(', ')}` }, { status: 400 });
  }
  if (process.env[job.envFlag] === 'false') {
    return NextResponse.json({ success: true, job: jobName, skipped: true, reason: 'disabled_by_env' });
  }

  try {
    await ensureDB();
    const result = await job.run();
    return NextResponse.json({ success: true, job: jobName, result });
  } catch (error) {
    console.error(`[cron/background-jobs] ${jobName} failed:`, error);
    return NextResponse.json({ success: false, job: jobName, error: 'Job failed' }, { status: 500 });
  }
}

export { POST as GET };
