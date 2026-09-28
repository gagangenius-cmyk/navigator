import dotenv from 'dotenv';
dotenv.config();

// Standalone persistent Node.js worker + scheduler process for the
// broadcast/workflow automation feature (docs/broadcast-architecture.md).
// Run this as its OWN process, separate from the Next.js app - it is not
// part of instrumentation.ts and must never run inside a Vercel serverless
// function (BullMQ Workers need a long-lived process to hold their Redis
// connection and keep polling for jobs). Start it with:
//   npm run worker
// (tsx workers/index.ts - see package.json). In production, run this
// alongside the Next.js app as a second process/container - e.g. via
// Dockerfile.prod + docker-compose.prod.yml, which already declares a
// redis service (previously unused - see docs/broadcast-architecture.md
// section 2's history on that).
//
// This file only wires up the Workers/scheduler; all the actual
// send/execute logic lives in src/lib/broadcastWorker.ts and
// src/lib/workflowRuntime.ts, reused as-is - this is deliberately a thin
// entrypoint, not a second implementation.

import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '../src/lib/redis';
import { connectDB } from '../src/lib/sequelize';
import { BROADCAST_QUEUE_NAME, type BroadcastRecipientJobData } from '../src/lib/queues/broadcastQueue';
import { WORKFLOW_QUEUE_NAME, type WorkflowJobData } from '../src/lib/queues/workflowQueue';
import { processBroadcastRecipient, processDueBroadcastRecipients, activateDueScheduledCampaigns } from '../src/lib/broadcastWorker';
import { processWorkflowStepById, resolveWaitById, processDueWorkflowSteps, resolveDueWaits } from '../src/lib/workflowRuntime';

const BROADCAST_CONCURRENCY = Number(process.env.BROADCAST_WORKER_CONCURRENCY || 10);
const WORKFLOW_CONCURRENCY = Number(process.env.WORKFLOW_WORKER_CONCURRENCY || 10);

// Scheduler cadence: campaign activation needs to be prompt (a campaign
// scheduled for a specific minute shouldn't slip by much), reconciliation
// is a safety net for the rare case a BullMQ enqueue call itself failed
// (e.g. a transient Redis blip between the DB write and the enqueue call),
// so it runs far less often - see broadcastWorker.ts/workflowRuntime.ts's
// own header comments on why both a real-time (BullMQ) and a reconciliation
// path exist.
const SCHEDULER_INTERVAL_MS = 30 * 1000;
const RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;

async function main() {
  await connectDB();
  const connection = getRedisConnection();

  const broadcastWorker = new Worker<BroadcastRecipientJobData>(
    BROADCAST_QUEUE_NAME,
    async (job: Job<BroadcastRecipientJobData>) => {
      await processBroadcastRecipient(job.data.recipientId);
    },
    { connection, concurrency: BROADCAST_CONCURRENCY }
  );
  broadcastWorker.on('failed', (job, error) => {
    console.error(`[broadcast-worker] job ${job?.id} failed:`, error);
  });

  const workflowWorker = new Worker<WorkflowJobData>(
    WORKFLOW_QUEUE_NAME,
    async (job: Job<WorkflowJobData>) => {
      if (job.data.kind === 'step') {
        await processWorkflowStepById(job.data.stepExecutionId);
      } else {
        await resolveWaitById(job.data.waitId);
      }
    },
    { connection, concurrency: WORKFLOW_CONCURRENCY }
  );
  workflowWorker.on('failed', (job, error) => {
    console.error(`[workflow-worker] job ${job?.id} failed:`, error);
  });

  console.log(`Broadcast worker started (concurrency ${BROADCAST_CONCURRENCY})`);
  console.log(`Workflow worker started (concurrency ${WORKFLOW_CONCURRENCY})`);

  const schedulerTimer = setInterval(async () => {
    try {
      const activated = await activateDueScheduledCampaigns();
      if (activated > 0) console.log(`Scheduler: activated ${activated} scheduled campaign(s)`);
    } catch (error) {
      console.error('Scheduler tick (activateDueScheduledCampaigns) failed:', error);
    }
  }, SCHEDULER_INTERVAL_MS);

  const reconciliationTimer = setInterval(async () => {
    try {
      const broadcastResult = await processDueBroadcastRecipients();
      const workflowResult = await processDueWorkflowSteps();
      const waitsResolved = await resolveDueWaits();
      if (broadcastResult.claimed > 0 || workflowResult.claimed > 0 || waitsResolved > 0) {
        console.log('Reconciliation sweep found stragglers:', { broadcastResult, workflowResult, waitsResolved });
      }
    } catch (error) {
      console.error('Reconciliation sweep failed:', error);
    }
  }, RECONCILIATION_INTERVAL_MS);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down workers...`);
    clearInterval(schedulerTimer);
    clearInterval(reconciliationTimer);
    await Promise.all([broadcastWorker.close(), workflowWorker.close()]);
    await connection.quit();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('Worker process failed to start:', error);
  process.exit(1);
});
