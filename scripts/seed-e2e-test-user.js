// Ensures ONE dedicated, clearly-labeled test employee exists for the
// Playwright e2e suite (see playwright.config.ts / tests/e2e). Deliberately
// additive-only - unlike scripts/seed-employees.js, this never updates or
// retires any other row. Safe to re-run; idempotent by username.
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const USERNAME = 'e2e_test_bot';
const EMPLOYEE_NAME = 'E2E Test Bot (do not delete - used by the Playwright suite)';

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const parsedUrl = new URL(databaseUrl);
  const connection = await mysql.createConnection({
    host: parsedUrl.hostname,
    port: Number(parsedUrl.port || 3306),
    user: decodeURIComponent(parsedUrl.username || ''),
    password: decodeURIComponent(parsedUrl.password || ''),
    database: parsedUrl.pathname.replace(/^\//, ''),
  });

  try {
    const [[role]] = await connection.query('SELECT id FROM crm_role WHERE name = ? AND status = 1 LIMIT 1', ['CEO']);
    if (!role) throw new Error('CEO role not found in crm_role - cannot create a full-access test account');

    const [[branch]] = await connection.query('SELECT id FROM crm_branch LIMIT 1');
    if (!branch) throw new Error('No row in crm_branch to assign the test employee to');

    const [existing] = await connection.query('SELECT id FROM crm_employee WHERE username = ? LIMIT 1', [USERNAME]);

    const password = crypto.randomBytes(18).toString('base64url');
    const hashed = await bcrypt.hash(password, 12);

    if (existing.length) {
      // Re-running just rotates the password (so a leaked/expired one from a
      // previous run can be refreshed) and makes sure it's active - never
      // touches any other employee row.
      await connection.query(
        'UPDATE crm_employee SET password = ?, status = 1, role = ?, branch = ? WHERE id = ?',
        [hashed, role.id, branch.id, existing[0].id]
      );
      console.log(`Updated existing test employee (id ${existing[0].id}).`);
    } else {
      await connection.query(
        `INSERT INTO crm_employee (
          name, email, cemail, mobile, cmobile, paddress, address, photo, dob,
          role, vendor_id, branch, region, username, password, status, ppNo,
          visaExp, department, EID, doj, nationality, dol, remark, labexp,
          bounce, em_local_name, em_home_name, em_local_number, em_home_number,
          religion, gender, crea, wfh, work_location, work_country, work_city,
          work_site, employment_type
        ) VALUES (
          ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          ?, 0, ?, NULL, ?, ?, 1, NULL,
          NULL, NULL, NULL, NULL, NULL, NULL, 'Playwright e2e test account - see scripts/seed-e2e-test-user.js', NULL,
          NULL, NULL, NULL, NULL, NULL,
          '', '', 1, 0, 'Onshore', 'UAE', NULL,
          NULL, 'Full-time'
        )`,
        [EMPLOYEE_NAME, role.id, branch.id, USERNAME, hashed]
      );
      console.log('Created new test employee.');
    }

    console.log(`\nE2E_TEST_USERNAME=${USERNAME}`);
    console.log(`E2E_TEST_PASSWORD=${password}`);
    console.log('\nAdd these two lines to .env (gitignored) so the Playwright suite can log in.');
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('E2E test user seed failed:', error);
  process.exit(1);
});
