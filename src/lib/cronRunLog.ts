import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';

// Every cron task in this codebase (lead-pool-sla-cron.ts, renewal-reminder-cron.ts,
// monthly-report-cron.ts, job-queue-cron.ts) previously only console.error'd on
// failure - a scheduled sweep silently failing every tick for days had no way to
// be noticed short of grepping server logs. This gives each run a row: when it
// started, how long it took, and whether it succeeded - surfaced on the System
// Jobs admin page. Self-migrating like every other table in this codebase.
let tableReady: Promise<void> | null = null;

const ensureCronRunLogTable = async () => {
  if (!tableReady) {
    tableReady = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_cron_run_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        detail TEXT NULL,
        duration_ms INT NULL,
        started_at DATETIME NOT NULL,
        INDEX idx_cron_run_log_job (job_name, started_at),
        INDEX idx_cron_run_log_started (started_at)
      )
    `).then(() => undefined).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  await tableReady;
};

// Wraps a cron task body: records a success/failure row with duration, then
// re-throws so the caller's own console.error (already present at every
// call site) still fires unchanged. Fire-and-forget on the logging itself -
// a failure to record history must never affect the sweep it's describing.
export async function withCronRunLog<T>(jobName: string, task: () => Promise<T>): Promise<T> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  try {
    const result = await task();
    void recordCronRun(jobName, 'success', summarize(result), Date.now() - startedAtMs, startedAt);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void recordCronRun(jobName, 'failed', message, Date.now() - startedAtMs, startedAt);
    throw error;
  }
}

function summarize(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  try {
    return JSON.stringify(result).slice(0, 2000);
  } catch {
    return null;
  }
}

async function recordCronRun(jobName: string, status: 'success' | 'failed', detail: string | null, durationMs: number, startedAt: Date): Promise<void> {
  try {
    await ensureCronRunLogTable();
    await sequelize.query(
      `INSERT INTO crm_cron_run_log (job_name, status, detail, duration_ms, started_at)
       VALUES (:jobName, :status, :detail, :durationMs, :startedAt)`,
      { replacements: { jobName, status, detail, durationMs, startedAt } }
    );
  } catch (error) {
    console.error('Failed to record cron run log entry:', error);
  }
}

export interface CronRunLogEntry {
  id: number;
  jobName: string;
  status: 'success' | 'failed';
  detail: string | null;
  durationMs: number | null;
  startedAt: string;
}

// Backs the System Jobs admin page.
export async function listRecentCronRuns(limit = 50): Promise<CronRunLogEntry[]> {
  await ensureCronRunLogTable();
  const rows = await sequelize.query<{
    id: number; job_name: string; status: 'success' | 'failed'; detail: string | null;
    duration_ms: number | null; started_at: string;
  }>(
    `SELECT * FROM crm_cron_run_log ORDER BY started_at DESC LIMIT :limit`,
    { replacements: { limit }, type: QueryTypes.SELECT }
  );
  return rows.map((r) => ({
    id: r.id,
    jobName: r.job_name,
    status: r.status,
    detail: r.detail,
    durationMs: r.duration_ms,
    startedAt: r.started_at,
  }));
}
