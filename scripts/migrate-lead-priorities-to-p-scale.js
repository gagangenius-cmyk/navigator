// Converts legacy lead priorities to the P1-P4 scale used by every Priority dropdown/filter:
//   critical -> P1, high -> P2, medium -> P3, low -> P4   (case-insensitive; blanks and P1-P4 untouched)
// Writes a JSON backup of every row it changes first.
//   node scripts/migrate-lead-priorities-to-p-scale.js              apply
//   node scripts/migrate-lead-priorities-to-p-scale.js --restore <backup.json>
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();
const u = new URL(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/dmconsultant_mydmcons_dm');
const MAP = { critical: 'P1', high: 'P2', medium: 'P3', low: 'P4' };

(async () => {
  const conn = await mysql.createConnection({
    host: u.hostname || 'localhost', port: Number(u.port || 3306),
    user: decodeURIComponent(u.username || 'root'), password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, ''),
  });
  const restoreIdx = process.argv.indexOf('--restore');
  if (restoreIdx > -1) {
    const rows = JSON.parse(fs.readFileSync(process.argv[restoreIdx + 1], 'utf8'));
    await conn.beginTransaction();
    for (const r of rows) await conn.query('UPDATE crm_forum_leads SET priority = ? WHERE id = ?', [r.priority, r.id]);
    await conn.commit();
    console.log('Restored', rows.length, 'leads');
    return conn.end();
  }
  const [leads] = await conn.query('SELECT id, priority FROM crm_forum_leads');
  const changes = leads
    .map((l) => ({ id: l.id, priority: l.priority, next: MAP[String(l.priority || '').trim().toLowerCase()] }))
    .filter((l) => l.next && l.next !== l.priority);
  if (!changes.length) { console.log('Nothing to convert.'); return conn.end(); }
  const dir = 'd:/tmp';
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `lead-priority-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(changes.map(({ id, priority }) => ({ id, priority })), null, 0));
  await conn.beginTransaction();
  try {
    for (const [from, to] of Object.entries(MAP)) {
      const [res] = await conn.query('UPDATE crm_forum_leads SET priority = ? WHERE LOWER(TRIM(priority)) = ? AND priority <> ?', [to, from, to]);
      console.log(`${from} -> ${to}: ${res.affectedRows} leads`);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; }
  console.log('Backup:', file);
  console.log('Restore: node scripts/migrate-lead-priorities-to-p-scale.js --restore', file);
  await conn.end();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
