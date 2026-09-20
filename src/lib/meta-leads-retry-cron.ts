import { retryFailedDeliveries } from '@/lib/meta/processor';
import { withCronRunLog } from '@/lib/cronRunLog';

type CronTask = {
  start: () => void;
};
type CronModule = {
  schedule: (
    expression: string,
    task: () => void | Promise<void>,
    options: { timezone: string; scheduled?: boolean }
  ) => CronTask;
};

declare global {
  var __dmMetaLeadsRetryCronStarted: boolean | undefined;
}

const loadNodeCron = async (): Promise<CronModule | null> => {
  try {
    const cronPackage = await import('node-cron');
    return (cronPackage.default || cronPackage) as CronModule;
  } catch (error) {
    console.warn('node-cron is not available; Meta leads retry sweep was not started.', error);
    return null;
  }
};

// Matches the interval documented in src/app/api/cron/meta-leads-retry/route.ts's
// own Vercel/VPS cron examples - this in-process scheduler is the alternative
// to configuring an external scheduler to hit that HTTP endpoint, so a
// deployment gets automatic retry of stuck crm_meta_lead_deliveries rows
// (retry_count/next_retry_at) even when no such external cron was ever set up.
const SCHEDULE_EXPRESSION = '*/5 * * * *';

export async function startMetaLeadsRetryCron() {
  if (globalThis.__dmMetaLeadsRetryCronStarted) {
    return { started: false, reason: 'already_started' };
  }

  if (process.env.META_LEADS_RETRY_CRON_ENABLED === 'false') {
    return { started: false, reason: 'disabled_by_env' };
  }

  const cron = await loadNodeCron();
  if (!cron) return { started: false, reason: 'node_cron_unavailable' };

  const task = cron.schedule(
    SCHEDULE_EXPRESSION,
    async () => {
      try {
        const result = await withCronRunLog('meta_leads_retry', () => retryFailedDeliveries());
        if (result.processed > 0 || result.errors > 0) {
          console.log(`Meta leads retry sweep: ${result.processed} processed, ${result.errors} errors.`);
        }
      } catch (error) {
        console.error('Meta leads retry sweep failed:', error);
      }
    },
    { timezone: 'Asia/Dubai', scheduled: true }
  );

  task.start();
  globalThis.__dmMetaLeadsRetryCronStarted = true;
  console.log(`Meta leads retry cron scheduled: ${SCHEDULE_EXPRESSION}`);
  return { started: true, schedule: SCHEDULE_EXPRESSION };
}
