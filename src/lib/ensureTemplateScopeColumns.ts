import { sequelize } from '@/lib/sequelize';

// Enterprise template scope (company > branch > role) on top of the existing
// branch_id/NULL model in crm_message_templates. Existing rows keep working:
// branch_id NULL = company scope, branch_id set = branch scope.
const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'scope_level', ddl: `ALTER TABLE crm_message_templates ADD COLUMN scope_level ENUM('company','branch','role') NOT NULL DEFAULT 'company'` },
  { name: 'role_id', ddl: `ALTER TABLE crm_message_templates ADD COLUMN role_id INT NULL` },
  { name: 'base_template_id', ddl: `ALTER TABLE crm_message_templates ADD COLUMN base_template_id INT NULL` },
];

let columnsReady: Promise<void> | null = null;
export const ensureTemplateScopeColumns = async (): Promise<void> => {
  if (!columnsReady) {
    columnsReady = (async () => {
      const [rows]: any = await sequelize.query(`
        SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_message_templates'
      `);
      const existing = new Set<string>((rows || []).map((r: { name: string }) => r.name));
      for (const col of COLUMNS) {
        if (!existing.has(col.name)) await sequelize.query(col.ddl);
      }
      // Rows created before scope_level existed: branch-bound ones are branch scope.
      if (!existing.has('scope_level')) {
        await sequelize.query(`UPDATE crm_message_templates SET scope_level = 'branch' WHERE branch_id IS NOT NULL`);
      }
    })().catch((error) => {
      columnsReady = null;
      throw error;
    });
  }
  await columnsReady;
};
