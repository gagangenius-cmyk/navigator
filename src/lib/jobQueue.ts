import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { captureError } from './errorTracking';

// Minimal DB-backed async job queue - deliberately not Redis/BullMQ. Nothing
// else in this project's stack uses Redis (no ioredis/bullmq dependency, no
// REDIS_* env var), and this app already runs its cron scheduling in-process
// via node-cron (see src/instrumentation.ts) rather than a separate worker
// process, so a table polled by that same heartbeat is the lowest-friction
// fit - no new infrastructure to provision or operate. If job volume or
// latency needs ever outgrow a 1-minute poll on a single process, that's the
// point to revisit Redis/BullMQ, not before.
//
// Self-migrating like every other table in this codebase (see
// src/lib/auditLog.ts's own note on this convention).
let tableReady: Promise<void> | null = null;

export const ensureJobQueueTable = async () => {
  if (!tableReady) {
    tableReady = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_job_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_type VARCHAR(100) NOT NULL,
        payload JSON NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        last_error TEXT NULL,
        run_after DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        INDEX idx_job_queue_poll (status, run_after),
        INDEX idx_job_queue_type (job_type)
      )
    `).then(() => undefined).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  await tableReady;
};

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();

// Handlers register themselves at import time (see registerJobHandlers()
// below, called once from instrumentation.ts) rather than this file
// importing every handler's module directly, so the queue itself never has
// to know the full set of job types any given deployment happens to use.
export function registerJobHandler(jobType: string, handler: JobHandler): void {
  handlers.set(jobType, handler);
}

export async function enqueueJob(jobType: string, payload: Record<string, unknown>, options?: { maxAttempts?: number; runAfter?: Date }): Promise<void> {
  try {
    await ensureJobQueueTable();
    await sequelize.query(
      `INSERT INTO crm_job_queue (job_type, payload, max_attempts, run_after)
       VALUES (:jobType, :payload, :maxAttempts, :runAfter)`,
      {
        replacements: {
          jobType,
          payload: JSON.stringify(payload),
          maxAttempts: options?.maxAttempts ?? 5,
          runAfter: options?.runAfter ?? new Date(),
        },
      }
    );
  } catch (error) {
    // Enqueue failing is itself the fallback-of-last-resort case - log it
    // loudly rather than throwing, since every call site treats "the async
    // side-effect didn't happen" as acceptable (that's the whole point of
    // queuing it instead of awaiting it inline), but silence would make a
    // systemic queue outage invisible.
    console.error(`Failed to enqueue job "${jobType}":`, error);
    captureError(error, { route: 'jobQueue:enqueue', extra: { jobType } });
  }
}

interface QueuedJobRow {
  id: number;
  job_type: string;
  payload: string | Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

// Exponential backoff: 1m, 5m, 25m, 2h05m, ... - generous enough that a
// transient provider outage (Resend down for a few minutes) clears on its
// own well before max_attempts is exhausted.
const backoffMinutes = (attempts: number) => Math.min(60 * 24, Math.round(5 ** attempts));

// Called from the job-queue cron tick (src/lib/job-queue-cron.ts). Processes
// whatever's due in one pass - not a long-running worker loop, matching
// every other cron task in this codebase (single sweep, then return control
// to node-cron for the next tick).
export async function processDueJobs(limit = 20): Promise<{ processed: number; succeeded: number; failed: number }> {
  await ensureJobQueueTable();

  const due = await sequelize.query<QueuedJobRow>(
    `SELECT id, job_type, payload, attempts, max_attempts FROM crm_job_queue
     WHERE status = 'pending' AND run_after <= NOW()
     ORDER BY run_after ASC
     LIMIT :limit`,
    { replacements: { limit }, type: QueryTypes.SELECT }
  );

  let succeeded = 0;
  let failed = 0;

  for (const job of due) {
    // Claim it first (processing) so a slow handler can't be picked up
    // twice by an overlapping tick - this project runs one Next.js process
    // per deployment (no separate worker fleet), but the cron tick interval
    // could still outlast a single run under load.
    await sequelize.query(
      `UPDATE crm_job_queue SET status = 'processing', attempts = attempts + 1 WHERE id = :id`,
      { replacements: { id: job.id } }
    );

    const handler = handlers.get(job.job_type);
    const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const attemptNumber = job.attempts + 1;

    try {
      if (!handler) throw new Error(`No job handler registered for type "${job.job_type}"`);
      await handler(payload);
      await sequelize.query(
        `UPDATE crm_job_queue SET status = 'completed', completed_at = NOW() WHERE id = :id`,
        { replacements: { id: job.id } }
      );
      succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attemptNumber >= job.max_attempts;
      await sequelize.query(
        `UPDATE crm_job_queue
         SET status = :status, last_error = :error, run_after = :runAfter
         WHERE id = :id`,
        {
          replacements: {
            id: job.id,
            status: exhausted ? 'failed' : 'pending',
            error: message,
            runAfter: new Date(Date.now() + backoffMinutes(attemptNumber) * 60 * 1000),
          },
        }
      );
      failed += 1;
      if (exhausted) {
        captureError(error, { route: 'jobQueue:exhausted', extra: { jobType: job.job_type, jobId: job.id } });
      }
    }
  }

  return { processed: due.length, succeeded, failed };
}

// Manual retry for a permanently-failed job - resets attempts to 0 so it
// gets the handler's full max_attempts budget again, used by the "Retry"
// action on the System Jobs admin page.
export async function retryFailedJob(jobId: number): Promise<boolean> {
  await ensureJobQueueTable();
  await sequelize.query(
    `UPDATE crm_job_queue SET status = 'pending', attempts = 0, run_after = NOW() WHERE id = :id AND status = 'failed'`,
    { replacements: { id: jobId } }
  );
  // Re-check rather than trust the UPDATE's affectedRows shape (mysql2/
  // Sequelize's typing for it is inconsistent across query styles - see
  // src/lib/leadPool.ts's own note on this) - a plain SELECT is the
  // reliable source of truth for whether this call actually changed it.
  const [row] = await sequelize.query<{ status: string }>(
    `SELECT status FROM crm_job_queue WHERE id = :id LIMIT 1`,
    { replacements: { id: jobId }, type: QueryTypes.SELECT }
  );
  return row?.status === 'pending';
}

export interface QueuedJobSummaryRow {
  id: number;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  runAfter: string;
  createdAt: string;
}

// Backs the System Jobs admin page - counts by status plus the most recent
// rows of each non-completed status, so the page can show what's stuck
// without pulling the (potentially large) completed history.
export async function getJobQueueSummary(): Promise<{
  counts: Record<string, number>;
  recent: QueuedJobSummaryRow[];
}> {
  await ensureJobQueueTable();

  const countRows = await sequelize.query<{ status: string; total: number }>(
    `SELECT status, COUNT(*) AS total FROM crm_job_queue GROUP BY status`,
    { type: QueryTypes.SELECT }
  );
  const counts: Record<string, number> = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of countRows) counts[row.status] = Number(row.total);

  const rows = await sequelize.query<{
    id: number; job_type: string; status: string; attempts: number; max_attempts: number;
    last_error: string | null; run_after: string; created_at: string;
  }>(
    `SELECT id, job_type, status, attempts, max_attempts, last_error, run_after, created_at
     FROM crm_job_queue
     WHERE status IN ('pending', 'processing', 'failed')
     ORDER BY id DESC
     LIMIT 100`,
    { type: QueryTypes.SELECT }
  );

  return {
    counts,
    recent: rows.map((r) => ({
      id: r.id,
      jobType: r.job_type,
      status: r.status,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      lastError: r.last_error,
      runAfter: r.run_after,
      createdAt: r.created_at,
    })),
  };
}
