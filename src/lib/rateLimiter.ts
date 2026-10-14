import { sequelize } from '@/lib/sequelize';

// Sliding-window rate limiter, MySQL-backed (no Redis in production).
// Used to throttle login attempts, which previously had no protection at all.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

const attemptsByKey = new Map<string, number[]>();

function pruneOld(timestamps: number[], windowMs: number, now: number): number[] {
  return timestamps.filter((t) => now - t < windowMs);
}

// Attempts are stored in MySQL (crm_rate_limit_attempts, see migrations/
// 20261014_rate_limit_attempts.sql) so limits hold across serverless
// instances/processes. If the table is missing or the DB errors, this falls
// back to the per-process in-memory map below rather than blocking logins.
let lastCleanup = 0;

async function dbCount(key: string, windowMs: number): Promise<{ count: number; oldestMsAgo: number }> {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS cnt, TIMESTAMPDIFF(MICROSECOND, MIN(attempted_at), CURRENT_TIMESTAMP(3)) / 1000 AS oldest_ms
     FROM crm_rate_limit_attempts
     WHERE rl_key = :key AND attempted_at > DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL :windowMs * 1000 MICROSECOND)`,
    { replacements: { key, windowMs } },
  );
  const row = (rows as Array<{ cnt: number | string; oldest_ms: number | string | null }>)[0];
  return { count: Number(row?.cnt || 0), oldestMsAgo: Number(row?.oldest_ms || 0) };
}

export async function checkRateLimit(
  key: string,
  options?: { windowMs?: number; maxAttempts?: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowMs = options?.windowMs ?? WINDOW_MS;
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  try {
    const { count, oldestMsAgo } = await dbCount(key, windowMs);
    if (count >= maxAttempts) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - oldestMsAgo) / 1000)) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  } catch {
    const now = Date.now();
    const timestamps = pruneOld(attemptsByKey.get(key) || [], windowMs, now);
    if (timestamps.length >= maxAttempts) {
      return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (now - timestamps[0])) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export async function recordFailedAttempt(key: string, options?: { windowMs?: number }): Promise<void> {
  const windowMs = options?.windowMs ?? WINDOW_MS;
  try {
    await sequelize.query('INSERT INTO crm_rate_limit_attempts (rl_key) VALUES (:key)', { replacements: { key } });
    const now = Date.now();
    if (now - lastCleanup > 10 * 60 * 1000) {
      lastCleanup = now;
      // Longest window any caller uses is well under a day.
      void sequelize
        .query('DELETE FROM crm_rate_limit_attempts WHERE attempted_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 DAY)')
        .catch(() => {});
    }
  } catch {
    const now = Date.now();
    const timestamps = pruneOld(attemptsByKey.get(key) || [], windowMs, now);
    timestamps.push(now);
    attemptsByKey.set(key, timestamps);
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  attemptsByKey.delete(key);
  try {
    await sequelize.query('DELETE FROM crm_rate_limit_attempts WHERE rl_key = :key', { replacements: { key } });
  } catch {
    // table missing / DB error - nothing more to clear
  }
}

export function getClientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// Keep the map from growing unbounded under sustained scanning/abuse. Uses a
// generously long window regardless of each caller's own windowMs — this
// sweep only exists for memory hygiene, not to enforce any limit itself.
const SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of attemptsByKey) {
    if (pruneOld(timestamps, SWEEP_WINDOW_MS, now).length === 0) attemptsByKey.delete(key);
  }
}, 10 * 60 * 1000).unref?.();
