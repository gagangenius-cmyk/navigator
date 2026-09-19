import { runContractReconciliation } from '@/lib/contractReconciliation';
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
  var __dmContractReconciliationCronStarted: boolean | undefined;
}

const loadNodeCron = async (): Promise<CronModule | null> => {
  try {
    const cronPackage = await import('node-cron');
    return (cronPackage.default || cronPackage) as CronModule;
  } catch (error) {
    console.warn('node-cron is not available; contract reconciliation sweep was not started.', error);
    return null;
  }
};

// Nightly at 2am - contract balances only change from a handful of known
// write paths (contract creation, a new receipt), so this doesn't need
// intraday freshness; matches this codebase's other nightly-scale jobs.
const SCHEDULE_EXPRESSION = '0 2 * * *';

export async function startContractReconciliationCron() {
  if (globalThis.__dmContractReconciliationCronStarted) {
    return { started: false, reason: 'already_started' };
  }

  if (process.env.CONTRACT_RECONCILIATION_CRON_ENABLED === 'false') {
    return { started: false, reason: 'disabled_by_env' };
  }

  const cron = await loadNodeCron();
  if (!cron) return { started: false, reason: 'node_cron_unavailable' };

  const task = cron.schedule(
    SCHEDULE_EXPRESSION,
    async () => {
      try {
        const result = await withCronRunLog('contract_reconciliation', () => runContractReconciliation());
        if (result.drifted > 0) {
          console.warn(`Contract reconciliation: ${result.drifted} of ${result.checked} contracts have drifted balances.`);
        }
      } catch (error) {
        console.error('Contract reconciliation sweep failed:', error);
      }
    },
    { timezone: 'Asia/Dubai', scheduled: true }
  );

  task.start();
  globalThis.__dmContractReconciliationCronStarted = true;
  console.log(`Contract reconciliation cron scheduled: ${SCHEDULE_EXPRESSION}`);
  return { started: true, schedule: SCHEDULE_EXPRESSION };
}
