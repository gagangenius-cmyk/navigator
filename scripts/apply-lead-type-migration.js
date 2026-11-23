// Lead Type: admin-configurable list (crm_lead_type) + crm_forum_leads.lead_type column.
// Safe to re-run: CREATE IF NOT EXISTS, adds the column/index only when missing, seeds only an empty table.
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();
const u = new URL(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/dmconsultant_mydmcons_dm');
const DEFAULT_TYPES = ['Individual', 'Family', 'Business'];
(async () => {
  const c = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username || 'root'), password: decodeURIComponent(u.password || ''), database: u.pathname.replace(/^\//, '') });
  await c.query(`
    CREATE TABLE IF NOT EXISTS crm_lead_type (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description VARCHAR(255) NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_crm_lead_type_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const [[cnt]] = await c.query('SELECT COUNT(*) n FROM crm_lead_type');
  if (cnt.n === 0) {
    for (const [i, name] of DEFAULT_TYPES.entries()) await c.query('INSERT INTO crm_lead_type (name, sort_order) VALUES (?, ?)', [name, (i + 1) * 10]);
    console.log('seeded', DEFAULT_TYPES.join(', '));
  }
  const [col] = await c.query("SHOW COLUMNS FROM crm_forum_leads LIKE 'lead_type'");
  if (!col.length) { await c.query('ALTER TABLE crm_forum_leads ADD COLUMN lead_type VARCHAR(100) NULL'); console.log('added crm_forum_leads.lead_type'); }
  const [idx] = await c.query("SHOW INDEX FROM crm_forum_leads WHERE Key_name = 'idx_crm_forum_leads_lead_type'");
  if (!idx.length) { await c.query('ALTER TABLE crm_forum_leads ADD INDEX idx_crm_forum_leads_lead_type (lead_type)'); console.log('added index'); }
  const [rows] = await c.query('SELECT id, name, is_enabled, sort_order FROM crm_lead_type ORDER BY sort_order, id');
  console.log('crm_lead_type:', rows.map((r) => `${r.id}:${r.name}`).join(', '));
  await c.end();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
