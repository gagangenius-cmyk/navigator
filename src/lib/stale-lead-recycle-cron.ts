import { runStaleLeadRecycleSweep } from '@/lib/staleLeadRecycle';
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
  var __dmStaleLeadRecycleCronStarted: boolean | undefined;
}

const loadNodeCron = async (): Promise<CronModule | null> => {
  try {
    const cronPackage = await import('node-cron');
    return (cronPackage.default || cronPackage) as CronModule;
  } catch (error) {
    console.warn('node-cron is not available; stale-lead recycle sweep was not started.', error);
    return null;
  }
};

// Runs every 15 minutes - frequent enough that even the shortest sensible
// stale_recycle_hours setting (a few hours) gets enforced promptly, without
// a per-rule DB scan every minute. Each rule's own stale_recycle_hours
// (crm_assignment_rules, CEO-editable per rule) is read fresh on every tick,
// so the sweep itself needs no settings lookup to decide whether to run -
// runStaleLeadRecycleSweep() is a no-op whenever no active rule has it set.
const SCHEDULE_EXPRESSION = '*/15 * * * *';

export async function startStaleLeadRecycleCron() {
  if (globalThis.__dmStaleLeadRecycleCronStarted) {
    return { started: false, reason: 'already_started' };
  }

  if (process.env.STALE_LEAD_RECYCLE_CRON_ENABLED === 'false') {
    return { started: false, reason: 'disabled_by_env' };
  }

  const cron = await loadNodeCron();
  if (!cron) return { started: false, reason: 'node_cron_unavailable' };

  const task = cron.schedule(
    SCHEDULE_EXPRESSION,
    async () => {
      try {
        const result = await withCronRunLog('stale_lead_recycle_sweep', () => runStaleLeadRecycleSweep());
        if (result.scanned > 0) {
          console.log(`Stale-lead recycle sweep: ${result.recycled} recycled (of ${result.scanned} stale, across ${result.rulesChecked} rules).`);
        }
      } catch (error) {
        console.error('Stale-lead recycle sweep failed:', error);
      }
    },
    { timezone: 'Asia/Dubai', scheduled: true }
  );

  task.start();
  globalThis.__dmStaleLeadRecycleCronStarted = true;
  console.log(`Stale-lead recycle sweep cron scheduled: ${SCHEDULE_EXPRESSION}`);
  return { started: true, schedule: SCHEDULE_EXPRESSION };
}
