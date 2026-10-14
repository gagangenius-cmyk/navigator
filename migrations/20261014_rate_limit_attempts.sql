-- Shared rate-limit store (replaces the per-process in-memory Map, which does
-- not work across serverless instances / multiple processes).
CREATE TABLE IF NOT EXISTS crm_rate_limit_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  rl_key VARCHAR(255) NOT NULL,
  attempted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_rl_key_time (rl_key, attempted_at),
  INDEX idx_rl_time (attempted_at)
);
