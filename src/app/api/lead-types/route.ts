import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

/**
 * GET /api/lead-types
 * Any logged-in staff member - feeds the Lead Type dropdowns and filter.
 * Editing the list is admin-only, see /api/admin/lead-types.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  await ensureDB();
  const rows = await sequelize.query(
    `SELECT id, name, description, sort_order FROM crm_lead_type WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC`,
    { type: QueryTypes.SELECT },
  );
  return NextResponse.json({ data: rows });
}
