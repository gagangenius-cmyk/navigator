-- Tables previously created lazily at request time by application code.
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS).

-- source: src\lib\auditLog.ts
CREATE TABLE IF NOT EXISTS crm_audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  summary VARCHAR(500) NULL,
  actor_id INT NULL,
  actor_role VARCHAR(80) NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_crm_audit_entity (entity_type, entity_id),
  INDEX idx_crm_audit_actor (actor_id),
  INDEX idx_crm_audit_created (created_at)
  );

-- source: src\app\api\calendar-events\route.ts
CREATE TABLE IF NOT EXISTS crm_calendar_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  event_date DATE NOT NULL,
  start_time VARCHAR(10) NULL,
  end_time VARCHAR(10) NULL,
  location VARCHAR(255) NULL,
  attendees_json TEXT NULL,
  images_json TEXT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'meeting',
  priority VARCHAR(10) NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );

-- source: src\app\api\clientportal\chat\route.ts
CREATE TABLE IF NOT EXISTS crm_client_chat_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_client_chat_log_lead (lead_id, created_at)
  );

-- source: src\lib\cronRunLog.ts
CREATE TABLE IF NOT EXISTS crm_cron_run_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL,
  detail TEXT NULL,
  duration_ms INT NULL,
  started_at DATETIME NOT NULL,
  INDEX idx_cron_run_log_job (job_name, started_at),
  INDEX idx_cron_run_log_started (started_at)
  );

-- source: src\lib\discountTierConfig.ts
CREATE TABLE IF NOT EXISTS crm_discount_tier_config (
  id INT NOT NULL PRIMARY KEY DEFAULT 1,
  auto_max_percent DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  bm_ceo_max_percent DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT NULL
  );

-- source: src\lib\mailer.ts
CREATE TABLE IF NOT EXISTS crm_email_delivery_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(255) NOT NULL,
  subject VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_delivery_status (status),
  INDEX idx_email_delivery_recipient (recipient),
  INDEX idx_email_delivery_created (created_at)
  );

-- source: src\app\api\settings\route.ts
CREATE TABLE IF NOT EXISTS crm_employee_preferences (
  employee_id INT NOT NULL PRIMARY KEY,
  email_notifications TINYINT NOT NULL DEFAULT 1,
  lead_alerts TINYINT NOT NULL DEFAULT 1,
  appointment_reminders TINYINT NOT NULL DEFAULT 1,
  payment_alerts TINYINT NOT NULL DEFAULT 1,
  whatsapp_template TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );

-- source: src\app\api\admin\hr\letter-log\route.ts
CREATE TABLE IF NOT EXISTS crm_hr_letter_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id VARCHAR(20) NOT NULL,
  template_name VARCHAR(255) NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  ref_number VARCHAR(100) NOT NULL,
  letter_date DATE NULL,
  generated_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

-- source: src\lib\jobQueue.ts
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
  );

-- source: src\lib\leadScore.ts
CREATE TABLE IF NOT EXISTS crm_lead_scores (
  lead_id INT NOT NULL PRIMARY KEY,
  score INT NOT NULL,
  label VARCHAR(20) NOT NULL,
  reasons JSON NULL,
  computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lead_scores_score (score),
  INDEX idx_lead_scores_label (label)
  );

-- source: src\app\api\admin\reports\route.ts
CREATE TABLE IF NOT EXISTS crm_saved_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  report_name VARCHAR(255) NOT NULL,
  report_type VARCHAR(50) NOT NULL,
  filters TEXT NULL,
  columns TEXT NULL,
  group_by VARCHAR(50) NULL,
  created_by INT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  );

-- source: src\lib\sms.ts
CREATE TABLE IF NOT EXISTS crm_sms_delivery_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(30) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  error TEXT NULL,
  actor_id INT NULL,
  lead_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sms_delivery_status (status),
  INDEX idx_sms_delivery_recipient (recipient),
  INDEX idx_sms_delivery_lead (lead_id),
  INDEX idx_sms_delivery_created (created_at)
  );

-- source: src\lib\whatsapp.ts
CREATE TABLE IF NOT EXISTS crm_whatsapp_delivery_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(30) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(255) NULL,
  error TEXT NULL,
  actor_id INT NULL,
  lead_id INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_whatsapp_delivery_status (status),
  INDEX idx_whatsapp_delivery_recipient (recipient),
  INDEX idx_whatsapp_delivery_lead (lead_id),
  INDEX idx_whatsapp_delivery_created (created_at)
  );

