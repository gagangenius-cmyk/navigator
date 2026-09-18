import { refreshLeadScores } from '@/lib/leadScore';
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
  var __dmLeadScoreCronStarted: boolean | undefined;
}

const loadNodeCron = async (): Promise<CronModule | null> => {
  try {
    const cronPackage = await import('node-cron');
    return (cronPackage.default || cronPackage) as CronModule;
  } catch (error) {
    console.warn('node-cron is not available; lead score refresh was not started.', error);
    return null;
  }
};

// Every 30 minutes - a rule-based score (see src/lib/leadScore.ts) only
// changes when status/priority/quality/assignment changes or activity gets
// logged, none of which need minute-level freshness the way the job queue does.
const SCHEDULE_EXPRESSION = '*/30 * * * *';

export async function startLeadScoreCron() {
  if (globalThis.__dmLeadScoreCronStarted) {
    return { started: false, reason: 'already_started' };
  }

  if (process.env.LEAD_SCORE_CRON_ENABLED === 'false') {
    return { started: false, reason: 'disabled_by_env' };
  }

  const cron = await loadNodeCron();
  if (!cron) return { started: false, reason: 'node_cron_unavailable' };

  const task = cron.schedule(
    SCHEDULE_EXPRESSION,
    async () => {
      try {
        const result = await withCronRunLog('lead_score_refresh', () => refreshLeadScores());
        if (result.scored > 0 || result.skipped > 0) {
          console.log(`Lead score refresh: ${result.scored} scored, ${result.skipped} skipped (already client/opportunity).`);
        }
      } catch (error) {
        console.error('Lead score refresh failed:', error);
      }
    },
    { timezone: 'Asia/Dubai', scheduled: true }
  );

  task.start();
  globalThis.__dmLeadScoreCronStarted = true;
  console.log(`Lead score refresh cron scheduled: ${SCHEDULE_EXPRESSION}`);
  return { started: true, schedule: SCHEDULE_EXPRESSION };
}
