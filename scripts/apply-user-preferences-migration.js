// Creates crm_user_preferences - per-login UI preferences (e.g. which list columns a person hides).
// Safe to re-run: CREATE TABLE IF NOT EXISTS, never touches existing rows.
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const databaseUrl = process.env.DATABASE_URL || 'mysql://root:@localhost:3306/dmconsultant_mydmcons_dm';
const u = new URL(databaseUrl);

(async () => {
  const conn = await mysql.createConnection({
    host: u.hostname || 'localhost',
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, ''),
  });
  await conn.query(`
    CREATE TABLE IF NOT EXISTS crm_user_preferences (
      user_id INT NOT NULL,
      pref_key VARCHAR(100) NOT NULL,
      pref_value MEDIUMTEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, pref_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  const [cols] = await conn.query('SHOW COLUMNS FROM crm_user_preferences');
  console.log('crm_user_preferences ready on', u.pathname.slice(1), '-', cols.map((c) => c.Field).join(', '));
  await conn.end();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
