import { sequelize } from '@/lib/sequelize';

// Tracks which Assignment Rule (crm_assignment_rules.id), if any, produced a
// lead's current assignTo - needed so the stale-lead recycle sweep
// (src/lib/staleLeadRecycle.ts) only ever recycles leads a rule actually
// assigned, through that same rule's own queue, never a manual pick or a
// different rule's lead.
let columnReady: Promise<void> | null = null;
export const ensureAssignedByRuleColumn = async (): Promise<void> => {
  if (!columnReady) {
    columnReady = sequelize.query(`
      SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_forum_leads' AND COLUMN_NAME = 'assigned_by_rule_id'
    `).then(async ([rows]: any) => {
      if (Number(rows?.[0]?.cnt || 0) === 0) {
        await sequelize.query(`ALTER TABLE crm_forum_leads ADD COLUMN assigned_by_rule_id INT NULL`);
      }
    }).catch((error) => {
      columnReady = null;
      throw error;
    });
  }
  await columnReady;
};
