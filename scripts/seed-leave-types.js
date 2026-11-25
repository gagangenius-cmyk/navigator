// Seeds crm_leave_type with the HR policy leave types when the table is empty (it was never
// populated on crm_next, so the Apply Leave dropdown had nothing in it). Safe to re-run:
// only inserts names that don't already exist.
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();
const u = new URL(process.env.DATABASE_URL || 'mysql://root:@localhost:3306/dmconsultant_mydmcons_dm');
const TYPES = ['Annual Leave', 'Sick Leave', 'Maternity Leave', 'Paternity Leave', 'Hajj Leave', 'Bereavement Leave', 'Unpaid Leave', 'Compensatory Leave', 'Emergency Leave', 'Early Leave'];
(async () => {
  const c = await mysql.createConnection({ host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username || 'root'), password: decodeURIComponent(u.password || ''), database: u.pathname.replace(/^\//, '') });
  const [have] = await c.query('SELECT name FROM crm_leave_type');
  const names = new Set(have.map((r) => r.name));
  let added = 0;
  for (const t of TYPES) if (!names.has(t)) { await c.query('INSERT INTO crm_leave_type (name, status) VALUES (?, 1)', [t]); added++; }
  const [rows] = await c.query('SELECT id, name, status FROM crm_leave_type ORDER BY id');
  console.log(`added ${added}; crm_leave_type now:`, rows.map((r) => `${r.id}:${r.name}`).join(', '));
  await c.end();
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
