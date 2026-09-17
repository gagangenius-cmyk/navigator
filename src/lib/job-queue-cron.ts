import { processDueJobs, registerJobHandler } from '@/lib/jobQueue';
import { withCronRunLog } from '@/lib/cronRunLog';
import { sendEmail } from '@/lib/mailer';

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
  var __dmJobQueueCronStarted: boolean | undefined;
}

const loadNodeCron = async (): Promise<CronModule | null> => {
  try {
    const cronPackage = await import('node-cron');
    return (cronPackage.default || cronPackage) as CronModule;
  } catch (error) {
    console.warn('node-cron is not available; job queue processor was not started.', error);
    return null;
  }
};

// 'send_email' is the only handler registered today (see the email call
// sites migrated to enqueueJob() in monthly-report-service.ts,
// hr-joining-exit-service.ts, client-portal-service.ts, and hr-service.ts's
// password-reset email) - sendEmail() already does its own delivery
// logging to crm_email_delivery_log, so the handler just needs to let a
// thrown error propagate for the queue's own retry/backoff to take over.
function registerBuiltInJobHandlers() {
  registerJobHandler('send_email', async (payload) => {
    await sendEmail({
      to: String(payload.to),
      subject: String(payload.subject),
      html: String(payload.html),
      attachments: payload.attachments as { filename: string; content: string }[] | undefined,
    });
  });
}

// Runs every minute - frequent enough that a queued email goes out within
// seconds of being enqueued in the common case, without polling so often
// it meaningfully adds to database load (this only SELECTs when jobs exist).
const SCHEDULE_EXPRESSION = '* * * * *';

export async function startJobQueueCron() {
  if (globalThis.__dmJobQueueCronStarted) {
    return { started: false, reason: 'already_started' };
  }

  if (process.env.JOB_QUEUE_CRON_ENABLED === 'false') {
    return { started: false, reason: 'disabled_by_env' };
  }

  const cron = await loadNodeCron();
  if (!cron) return { started: false, reason: 'node_cron_unavailable' };

  registerBuiltInJobHandlers();

  const task = cron.schedule(
    SCHEDULE_EXPRESSION,
    async () => {
      try {
        const result = await withCronRunLog('job_queue_processor', () => processDueJobs());
        if (result.processed > 0) {
          console.log(`Job queue: ${result.succeeded} succeeded, ${result.failed} failed (of ${result.processed} due).`);
        }
      } catch (error) {
        console.error('Job queue processing failed:', error);
      }
    },
    { timezone: 'Asia/Dubai', scheduled: true }
  );

  task.start();
  globalThis.__dmJobQueueCronStarted = true;
  console.log(`Job queue processor cron scheduled: ${SCHEDULE_EXPRESSION}`);
  return { started: true, schedule: SCHEDULE_EXPRESSION };
}
