import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

// Per-login UI preferences (e.g. which list columns each person hides).
// Always scoped to the caller's own user id from the auth token.
let ready = false;
async function ensureTable() {
  if (ready) return;
  await connectDB();
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS crm_user_preferences (
      user_id INT NOT NULL,
      pref_key VARCHAR(100) NOT NULL,
      pref_value MEDIUMTEXT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, pref_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ready = true;
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!key || key.length > 100) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  await ensureTable();
  const rows = await sequelize.query<{ pref_value: string | null }>(
    'SELECT pref_value FROM crm_user_preferences WHERE user_id = :uid AND pref_key = :key',
    { replacements: { uid: auth.id, key }, type: QueryTypes.SELECT },
  );
  let value: unknown = null;
  try { value = rows[0]?.pref_value ? JSON.parse(rows[0].pref_value) : null; } catch { value = null; }
  return NextResponse.json({ value });
}

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  const body = await request.json().catch(() => null);
  const key = String(body?.key || '');
  if (!key || key.length > 100) return NextResponse.json({ error: 'key is required' }, { status: 400 });
  const json = JSON.stringify(body?.value ?? null);
  if (json.length > 100_000) return NextResponse.json({ error: 'Value too large' }, { status: 413 });
  await ensureTable();
  await sequelize.query(
    `INSERT INTO crm_user_preferences (user_id, pref_key, pref_value) VALUES (:uid, :key, :val)
     ON DUPLICATE KEY UPDATE pref_value = VALUES(pref_value)`,
    { replacements: { uid: auth.id, key, val: json } },
  );
  return NextResponse.json({ success: true });
}
