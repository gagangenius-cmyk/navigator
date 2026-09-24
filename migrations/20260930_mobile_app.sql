-- Mobile app (React Native, /mobile) session + push-device storage.
-- Self-provisioned lazily by src/lib/mobileSchema.ts ensureMobileTables(),
-- the same pattern as crm_job_queue / crm_employee_mfa - this file exists for
-- fresh-install parity and documentation. Idempotent (CREATE TABLE IF NOT EXISTS).
--
-- crm_mobile_sessions: one row per issued refresh token. Refresh tokens are
-- never stored in the clear - only their sha256 (token_hash). Every refresh
-- rotates the token: the old row gets revoked_at + replaced_by and a new row
-- joins the same family_id. Presenting an already-revoked token means it was
-- stolen or replayed, so the whole family is revoked (see mobileAuth.ts).
-- family_started_at anchors the absolute session lifetime cap.
--
-- crm_mobile_devices: one row per native push token - an FCM registration
-- token on Android, a raw APNs device token on iOS (the app uses
-- expo-notifications getDevicePushTokenAsync; the server talks to FCM and
-- APNs directly, see src/lib/mobilePush*.ts). push_token is unique so a phone
-- that changes hands re-binds to the new employee instead of pushing the
-- previous user's notifications to it. environment records which APNs
-- endpoint an iOS token belongs to (development builds use sandbox).

CREATE TABLE IF NOT EXISTS crm_mobile_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  family_id CHAR(36) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  family_started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by INT NULL,
  device_name VARCHAR(150) NULL,
  platform VARCHAR(20) NULL,
  ip_address VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  UNIQUE KEY uq_mobile_session_token (token_hash),
  INDEX idx_mobile_session_employee (employee_id),
  INDEX idx_mobile_session_family (family_id),
  CONSTRAINT fk_mobile_session_employee FOREIGN KEY (employee_id) REFERENCES crm_employee(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm_mobile_devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  push_token VARCHAR(512) NOT NULL,
  platform VARCHAR(20) NOT NULL,
  environment VARCHAR(12) NULL,
  device_name VARCHAR(150) NULL,
  app_version VARCHAR(30) NULL,
  is_active TINYINT NOT NULL DEFAULT 1,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mobile_device_token (push_token),
  INDEX idx_mobile_device_employee (employee_id, is_active),
  CONSTRAINT fk_mobile_device_employee FOREIGN KEY (employee_id) REFERENCES crm_employee(id) ON DELETE CASCADE
);
