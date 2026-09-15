import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

/**
 * GET /api/meta-leads/quality-options
 * Any logged-in staff member — this only feeds the "Meta Lead Quality"
 * dropdown on the lead status form. Editing the mappings themselves stays
 * admin-only (see /api/admin/meta-leads/quality-mappings).
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const rows = await sequelize.query<{ quality_label: string }>(
    `SELECT quality_label FROM crm_meta_quality_mappings WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC`,
    { type: QueryTypes.SELECT },
  );

  return NextResponse.json({ data: rows.map((r) => r.quality_label) });
}
