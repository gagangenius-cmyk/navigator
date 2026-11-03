import { sequelize } from '@/lib/sequelize';

// Self-migrating like the rest of this codebase (see lib/mailboxes.ts): the
// tables are created on first use, so no manual migration has to run before
// the feature works on a given database.
let ready: Promise<void> | null = null;

export const ensureTemplateSendTables = async () => {
  if (!ready) {
    ready = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_template_sends (
          id INT AUTO_INCREMENT PRIMARY KEY,
          template_id INT NOT NULL,
          template_version_id INT NOT NULL,
          template_name VARCHAR(255) NOT NULL,
          sender_mode VARCHAR(8) NOT NULL DEFAULT 'me',
          status VARCHAR(16) NOT NULL DEFAULT 'queued',
          scheduled_at_utc DATETIME NULL,
          total_selected INT NOT NULL DEFAULT 0,
          total_queued INT NOT NULL DEFAULT 0,
          total_skipped INT NOT NULL DEFAULT 0,
          idempotency_key VARCHAR(100) NOT NULL,
          created_by INT NOT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at DATETIME NULL,
          UNIQUE KEY uq_template_sends_key (idempotency_key),
          INDEX idx_template_sends_status (status, scheduled_at_utc),
          INDEX idx_template_sends_creator (created_by, created_at)
        )
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_template_send_items (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          send_id INT NOT NULL,
          lead_id INT NOT NULL,
          sender_employee_id INT NULL,
          mailbox_id INT NULL,
          to_email VARCHAR(255) NULL,
          status VARCHAR(12) NOT NULL DEFAULT 'queued',
          skip_reason VARCHAR(40) NULL,
          attempts INT NOT NULL DEFAULT 0,
          next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          lock_token VARCHAR(40) NULL,
          locked_at DATETIME NULL,
          last_error VARCHAR(2000) NULL,
          subject VARCHAR(998) NULL,
          from_email VARCHAR(255) NULL,
          provider_message_id VARCHAR(500) NULL,
          sent_at DATETIME NULL,
          UNIQUE KEY uq_template_send_item (send_id, lead_id),
          INDEX idx_template_send_items_queue (status, next_attempt_at),
          INDEX idx_template_send_items_send (send_id, status)
        )
      `);
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_template_send_events (
          id BIGINT AUTO_INCREMENT PRIMARY KEY,
          send_id INT NOT NULL,
          item_id BIGINT NULL,
          event VARCHAR(24) NOT NULL,
          detail VARCHAR(2000) NULL,
          actor_id INT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_template_send_events_send (send_id, id),
          INDEX idx_template_send_events_item (item_id)
        )
      `);
    })().catch((error) => {
      ready = null;
      throw error;
    });
  }
  await ready;
};
