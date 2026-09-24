import { sequelize } from './sequelize';

// Self-migrating tables for the mobile app, the same convention as
// src/lib/jobQueue.ts and src/lib/mfa.ts. migrations/20260930_mobile_app.sql
// holds the identical DDL for fresh installs and documentation.
//
// The foreign key to crm_employee is attempted first; if the database refuses
// it (a legacy MyISAM/collation mismatch on crm_employee), the tables are
// created without it rather than failing every mobile login. The app-level
// behaviour is the same - rows are only ever written for a real employee id.
const sessionsDdl = (withFk: boolean) => `
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
    INDEX idx_mobile_session_family (family_id)
    ${withFk ? ', CONSTRAINT fk_mobile_session_employee FOREIGN KEY (employee_id) REFERENCES crm_employee(id) ON DELETE CASCADE' : ''}
  )`;

const devicesDdl = (withFk: boolean) => `
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
    INDEX idx_mobile_device_employee (employee_id, is_active)
    ${withFk ? ', CONSTRAINT fk_mobile_device_employee FOREIGN KEY (employee_id) REFERENCES crm_employee(id) ON DELETE CASCADE' : ''}
  )`;

// MySQL errno values for "could not create the FK": 1005 (can't create table),
// 1215 (cannot add foreign key constraint), 3780/3734 (incompatible columns).
const FK_ERRNOS = new Set([1005, 1215, 3780, 3734]);

async function createTable(ddl: (withFk: boolean) => string): Promise<void> {
  try {
    await sequelize.query(ddl(true));
  } catch (error) {
    const errno = (error as { original?: { errno?: number } }).original?.errno;
    if (errno && FK_ERRNOS.has(errno)) {
      await sequelize.query(ddl(false));
      return;
    }
    throw error;
  }
}

let tablesReady: Promise<void> | null = null;

export async function ensureMobileTables(): Promise<void> {
  if (!tablesReady) {
    tablesReady = (async () => {
      await createTable(sessionsDdl);
      await createTable(devicesDdl);
    })().catch((error) => {
      tablesReady = null;
      throw error;
    });
  }
  await tablesReady;
}
