const mysql = require('mysql2/promise');
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

async function run() {
  const url = new URL(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/dmconsultant_mydmcons_dm');
  const db = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username || 'root'),
    password: decodeURIComponent(url.password || ''),
    database: url.pathname.slice(1),
  });
  console.log('Target database:', url.pathname.slice(1), 'on', url.hostname);

  const [rows] = await db.query(`
    SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_message_templates'`);
  const existing = new Set(rows.map((r) => r.name));
  if (!existing.size) { console.log('crm_message_templates not found, nothing to do.'); await db.end(); return; }

  const cols = [
    ['scope_level', `ALTER TABLE crm_message_templates ADD COLUMN scope_level ENUM('company','branch','role') NOT NULL DEFAULT 'company'`],
    ['role_id', `ALTER TABLE crm_message_templates ADD COLUMN role_id INT NULL`],
    ['base_template_id', `ALTER TABLE crm_message_templates ADD COLUMN base_template_id INT NULL`],
  ];
  for (const [name, ddl] of cols) {
    if (existing.has(name)) { console.log(name, 'already exists, skipping.'); continue; }
    await db.query(ddl);
    console.log('Added', name);
  }
  if (!existing.has('scope_level')) {
    const [r] = await db.query(`UPDATE crm_message_templates SET scope_level = 'branch' WHERE branch_id IS NOT NULL`);
    console.log('Backfilled branch scope on', r.affectedRows, 'rows');
  }
  await db.end();
}
run().catch((e) => { console.error(e.message); process.exit(1); });
