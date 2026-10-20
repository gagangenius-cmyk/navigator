import { runMetaAutoSync } from '@/lib/meta/sync';
import { withCronRunLog } from '@/lib/cronRunLog';

type CronTask = { start: () => void };
type CronModule = {
  schedule: (
    expression: string,
    task: () => void | Promise<void>,
    options: { timezone: string; scheduled?: boolean }
  ) => CronTask;
};

declare global {
  var __dmMetaSyncCronStarted: boolean | undefined;
}

const loadNodeCron = async (): Promise<CronModule | null> => {
  try {
    const cronPackage = await import('node-cron');
    return (cronPackage.default || cronPackage) as CronModule;
  } catch (error) {
    console.warn('node-cron is not available; Meta auto-sync was not started.', error);
    return null;
  }
};

// Every 15 minutes: picks up new campaigns/forms/questions and recovers any
// lead whose webhook never arrived. Webhooks stay the real-time path; this is
// the safety net. On Vercel (no long-lived process) call /api/cron/meta-sync instead.
const SCHEDULE_EXPRESSION = '*/15 * * * *';

export async function startMetaSyncCron() {
  if (globalThis.__dmMetaSyncCronStarted) return { started: false, reason: 'already_started' };
  if (process.env.META_AUTO_SYNC_CRON_ENABLED === 'false') return { started: false, reason: 'disabled_by_env' };

  const cron = await loadNodeCron();
  if (!cron) return { started: false, reason: 'node_cron_unavailable' };

  const task = cron.schedule(
    SCHEDULE_EXPRESSION,
    async () => {
      try {
        const summary = await withCronRunLog('meta_auto_sync', () => runMetaAutoSync());
        if (summary.forms?.newForms || summary.backfill?.recovered || summary.errors.length) {
          console.log('Meta auto-sync:', JSON.stringify(summary));
        }
      } catch (error) {
        console.error('Meta auto-sync failed:', error);
      }
    },
    { timezone: 'Asia/Dubai', scheduled: true }
  );

  task.start();
  globalThis.__dmMetaSyncCronStarted = true;
  console.log(`Meta auto-sync cron scheduled: ${SCHEDULE_EXPRESSION}`);
  return { started: true, schedule: SCHEDULE_EXPRESSION };
}
