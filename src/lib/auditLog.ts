import { sequelize } from './sequelize';

// General-purpose "who changed what, when" trail for the mutation paths that
// had no audit coverage at all before this: payments, RBAC/role permissions,
// employee account changes (role/status/password resets), and
// discount/compliance approval decisions. Deliberately separate from
// src/lib/leadRemarks.ts (lead-scoped activity feed) and
// src/lib/dataAccessAudit.ts (read/view access to sensitive records) - this
// one is for state-changing admin actions across any entity type.
//
// Self-migrating like dataAccessAudit.ts/ensureClientActualNameColumn.ts -
// this codebase has no separate migration-file tooling, so every module
// CREATE TABLE IF NOT EXISTS's its own table on first use.
let tableReady: Promise<void> | null = null;

// Exported so the read-only /api/audit-log GET route can ensure the table
// exists before querying it (e.g. on a fresh DB where nothing has logged yet).
export const ensureAuditLogTable = async () => {
  if (!tableReady) {
    tableReady = sequelize.query(`
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
      )
    `).then(() => undefined).catch((error) => {
      tableReady = null;
      throw error;
    });
  }
  await tableReady;
};

export interface AuditLogInput {
  entityType: string;
  entityId: number | string;
  action: string;
  summary?: string | null;
  actorId?: number | null;
  actorRole?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

// Fire-and-forget, matching every other audit hook in this codebase
// (logLeadRemark, logDataAccess) - a failed audit write must never fail or
// slow down the actual request it's logging. Never pass secrets (passwords,
// tokens) in `before`/`after` - log that the action happened, not the value.
export async function logAudit({
  entityType,
  entityId,
  action,
  summary = null,
  actorId = null,
  actorRole = null,
  before = null,
  after = null,
}: AuditLogInput): Promise<void> {
  try {
    await ensureAuditLogTable();
    await sequelize.query(
      `INSERT INTO crm_audit_log (entity_type, entity_id, action, summary, actor_id, actor_role, before_value, after_value)
       VALUES (:entityType, :entityId, :action, :summary, :actorId, :actorRole, :before, :after)`,
      {
        replacements: {
          entityType,
          entityId: String(entityId),
          action,
          summary,
          actorId,
          actorRole,
          before: before ? JSON.stringify(before) : null,
          after: after ? JSON.stringify(after) : null,
        },
      }
    );
  } catch (error) {
    console.error('Failed to record audit log entry:', error);
  }
}
