/**
 * Reset the CRM database to a clean slate: every business record is removed, and only the accounts,
 * roles and permissions (plus the small amount of configuration the CRM cannot run without) stay.
 *
 *   node scripts/reset-database.js                                  dry run - prints the plan, changes nothing
 *   node scripts/reset-database.js --apply --confirm-database=NAME  really do it
 *
 * Options:
 *   --backup-dir=DIR   where the pre-wipe SQL backup goes (default: ~/db-backups, outside the repo)
 *
 * Safety:
 *   - The dry run is the default; --apply also needs --confirm-database=<the database name it will touch>.
 *   - Every table (kept ones too) is dumped to a .sql file first, from one consistent snapshot. The dump's row
 *     counts are checked against the database, and the wipe aborts if anything differs or a table changed
 *     between the backup and the wipe.
 *   - Any table that is not in a keep list below is wiped, so tables added later are cleaned too.
 *   - Restore with: mysql --default-character-set=utf8mb4 DB < backup.sql
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

// Users, roles and permissions: what you asked to keep.
const KEEP_ACCESS = [
  'crm_role',
  'crm_permissions',
  'crm_role_permissions',
  'crm_employee',
  'crm_employee_mfa', // an employee's MFA enrolment: dropping it would silently turn their MFA off
  'crm_employee_preferences',
];

// Configuration the CRM cannot function without. None of it is business data, and each is either
// referenced by the kept users or needed to add a fee, a lead or an expense.
const KEEP_CONFIG = {
  crm_program_type: 'fixed taxonomy - nothing in the CRM can add a program type, and the fee form requires one',
  crm_branch: 'branches: referenced by users, and required by the fee form',
  crm_region: 'regions: referenced by users and branches',
  crm_department: 'departments: referenced by users',
  crm_currency: 'currencies: required by the fee form (foreign key)',
  crm_exchange_rate: 'exchange rates (foreign key from the branch map)',
  crm_branch_exchange_rate_map: 'branch to exchange rate map',
  crm_lead_status: 'lead statuses: the lead workflow keys off them',
  crm_source: 'lead sources',
  crm_coa_accounts: 'chart of accounts (foreign key from expenses)',
  crm_discount_tier_config: 'discount approval thresholds',
  crm_it_settings: 'IT support settings',
  crm_meta_settings: 'Meta (Facebook) integration settings',
  crm_meta_lead_mappings: 'Meta field mappings',
  crm_meta_quality_mappings: 'Meta lead-quality mappings',
  crm_hr_attendance_settings: 'attendance settings',
  crm_hr_letter_templates: 'HR letter templates',
  crm_email_templates: 'email templates',
  crm_leave_type: 'leave types',
  crm_auto_reassignment_rules: 'auto-reassignment rules',
};

// Wiped, but the id counter is kept. Code such as src/lib/opsVisaType.ts buckets services by id range
// before it looks at the name, and legacy routing keys off country ids, so re-adding these from id 1 would
// silently misclassify the first programs and countries.
const PRESERVE_AUTO_INCREMENT = ['crm_service', 'crm_country_proces', 'crm_fee', 'crm_countries_type_program'];

const KEEP = new Set([...KEEP_ACCESS, ...Object.keys(KEEP_CONFIG)]);

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const q = (name) => `\`${name.replace(/`/g, '``')}\``;

function connectionConfig() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    dateStrings: true,
    jsonStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

async function countRows(conn, tables) {
  const counts = {};
  for (const table of tables) {
    const [[row]] = await conn.query(`SELECT COUNT(*) AS n FROM ${q(table)}`);
    counts[table] = Number(row.n);
  }
  return counts;
}

async function writeBackup(conn, tables, file) {
  const out = fs.createWriteStream(file, { encoding: 'utf8' });
  const write = (text) => new Promise((resolve, reject) => out.write(text, (e) => (e ? reject(e) : resolve())));
  const written = {};

  await write(`-- ${conn.config.database} backup taken ${new Date().toISOString()} by scripts/reset-database.js\n`);
  await write('SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\n\n');

  for (const table of tables) {
    const [[create]] = await conn.query(`SHOW CREATE TABLE ${q(table)}`);
    await write(`-- ${table}\nDROP TABLE IF EXISTS ${q(table)};\n${create['Create Table']};\n`);
    const [rows, fields] = await conn.query({ sql: `SELECT * FROM ${q(table)}`, rowsAsArray: true });
    written[table] = rows.length;
    const columns = fields.map((f) => q(f.name)).join(', ');
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200).map((row) => `(${row.map((v) => conn.escape(v)).join(', ')})`);
      await write(`INSERT INTO ${q(table)} (${columns}) VALUES\n${batch.join(',\n')};\n`);
    }
    await write(`-- ${table}: ${rows.length} row(s)\n\n`);
  }
  await write('SET UNIQUE_CHECKS=1;\nSET FOREIGN_KEY_CHECKS=1;\n');
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  return written;
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const config = connectionConfig();
  const apply = flag('apply');
  const conn = await mysql.createConnection(config);
  await conn.query('SET SESSION information_schema_stats_expiry = 0');

  const [[server]] = await conn.query('SELECT @@hostname AS host, VERSION() AS version');
  console.log(`Database : ${config.database} on ${config.host}:${config.port} (MySQL ${server.version}, host ${server.host})`);
  console.log(`Mode     : ${apply ? 'APPLY' : 'dry run (nothing will be changed)'}\n`);

  const [tableRows] = await conn.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
  );
  const tables = tableRows.map((r) => r.t);
  const counts = await countRows(conn, tables);

  const missingKeep = [...KEEP].filter((t) => !tables.includes(t));
  const keep = tables.filter((t) => KEEP.has(t));
  const wipe = tables.filter((t) => !KEEP.has(t));

  console.log(`KEEP - users, roles, permissions:`);
  for (const t of KEEP_ACCESS.filter((t) => tables.includes(t))) console.log(`  ${String(counts[t]).padStart(6)}  ${t}`);
  console.log(`\nKEEP - configuration the CRM needs (not business data):`);
  for (const t of Object.keys(KEEP_CONFIG).filter((t) => tables.includes(t))) console.log(`  ${String(counts[t]).padStart(6)}  ${t.padEnd(30)} ${KEEP_CONFIG[t]}`);
  if (missingKeep.length) console.log(`\n  (not present in this database, ignored: ${missingKeep.join(', ')})`);

  const wipeRows = wipe.reduce((sum, t) => sum + counts[t], 0);
  console.log(`\nWIPE - ${wipe.length} tables, ${wipeRows} rows in total. Tables that currently hold rows:`);
  for (const t of wipe.filter((t) => counts[t] > 0)) console.log(`  ${String(counts[t]).padStart(6)}  ${t}`);
  console.log(`  (${wipe.filter((t) => counts[t] === 0).length} more tables are already empty and are reset too)`);

  const [autoRows] = await conn.query(
    'SELECT TABLE_NAME AS t, AUTO_INCREMENT AS a FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)',
    [PRESERVE_AUTO_INCREMENT],
  );
  const autoIncrement = Object.fromEntries(autoRows.map((r) => [r.t, Number(r.a)]));
  console.log(`\nId counters kept after the wipe: ${Object.entries(autoIncrement).map(([t, a]) => `${t}=${a}`).join(', ')}`);

  if (!apply) {
    console.log('\nDry run only. To do it: node scripts/reset-database.js --apply --confirm-database=' + config.database);
    await conn.end();
    return;
  }

  if (option('confirm-database') !== config.database) {
    console.error(`\nRefusing to continue: pass --confirm-database=${config.database} to confirm this is the database to wipe.`);
    process.exitCode = 1;
    await conn.end();
    return;
  }

  // 1. Backup, from one consistent snapshot, then prove it.
  const backupDir = path.resolve(option('backup-dir') || path.join(os.homedir(), 'db-backups'));
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `${config.database}-${stamp}.sql`);

  await conn.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
  const snapshotCounts = await countRows(conn, tables);
  const written = await writeBackup(conn, tables, backupFile);
  await conn.query('COMMIT');

  const mismatched = tables.filter((t) => written[t] !== snapshotCounts[t]);
  if (mismatched.length) throw new Error(`Backup row counts disagree with the snapshot for: ${mismatched.join(', ')}. Nothing was wiped.`);
  const size = fs.statSync(backupFile).size;
  const digest = sha256(backupFile);
  fs.writeFileSync(`${backupFile}.manifest.json`, JSON.stringify({ database: config.database, takenAt: new Date().toISOString(), sha256: digest, bytes: size, rows: written }, null, 2));
  console.log(`\nBackup   : ${backupFile}\n           ${(size / 1024).toFixed(0)} KiB, ${tables.length} tables, ${Object.values(written).reduce((a, b) => a + b, 0)} rows, sha256 ${digest.slice(0, 16)}...`);

  // 2. Abort if the database changed since the backup (a user working in the CRM would lose those rows).
  const before = await countRows(conn, tables);
  const changed = tables.filter((t) => before[t] !== snapshotCounts[t]);
  if (changed.length) throw new Error(`These tables changed while the backup ran: ${changed.join(', ')}. Nothing was wiped - run it again.`);

  // 3. Wipe. TRUNCATE is used (fast, resets counters) with foreign-key checks off for this session only.
  await conn.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of wipe) {
      await conn.query(`TRUNCATE TABLE ${q(table)}`);
      if (autoIncrement[table] > 1) await conn.query(`ALTER TABLE ${q(table)} AUTO_INCREMENT = ${autoIncrement[table]}`);
    }
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  }

  // 4. A country + program type + program pair can only be mapped once. Enforce it in the schema so two fees saved
  //    at the same moment cannot create duplicate mapping rows. The table is empty now, so this cannot fail on data.
  const [existingKey] = await conn.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_countries_type_program' AND INDEX_NAME = 'uq_country_type_program' LIMIT 1",
  );
  if (!existingKey.length) {
    await conn.query('ALTER TABLE crm_countries_type_program ADD UNIQUE KEY uq_country_type_program (country, type, program)');
    console.log('Schema   : added UNIQUE KEY uq_country_type_program (country, type, program) on crm_countries_type_program');
  }

  // 5. Verify.
  const after = await countRows(conn, tables);
  const stillFull = wipe.filter((t) => after[t] !== 0);
  const keptChanged = keep.filter((t) => after[t] !== snapshotCounts[t]);
  await conn.end();
  if (stillFull.length || keptChanged.length) {
    throw new Error(`Verification failed. Not empty: [${stillFull.join(', ')}]. Kept tables that changed: [${keptChanged.join(', ')}]. Restore from ${backupFile}.`);
  }
  console.log(`\nDone. ${wipe.length} tables wiped (${wipeRows} rows removed); ${keep.length} tables untouched.`);
  console.log(`Verified: every wiped table is empty and every kept table has exactly the rows it had.`);
}

main().catch((error) => {
  console.error('\nFAILED:', error.message);
  process.exit(1);
});
