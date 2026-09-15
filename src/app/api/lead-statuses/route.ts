import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

export interface LeadStatusOption {
  id: number;
  name: string;
  badge_class: string;
  kanban_accent_class: string;
  kanban_tint_class: string;
  uses_p_priority_scale: number;
  sort_order: number;
}

/**
 * GET /api/lead-statuses
 * Any logged-in staff member — feeds every status dropdown/filter/Kanban
 * board in the app. Editing the list itself is admin-only, see
 * /api/admin/lead-statuses.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const rows = await sequelize.query<LeadStatusOption>(
    `SELECT id, name, badge_class, kanban_accent_class, kanban_tint_class, uses_p_priority_scale, sort_order
     FROM crm_lead_status
     WHERE is_enabled = 1
     ORDER BY sort_order ASC, id ASC`,
    { type: QueryTypes.SELECT },
  );

  return NextResponse.json({ data: rows });
}
