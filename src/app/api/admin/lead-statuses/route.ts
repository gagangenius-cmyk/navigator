import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const rows = await sequelize.query(
    `SELECT id, name, badge_class, kanban_accent_class, kanban_tint_class,
            uses_p_priority_scale, is_enabled, sort_order, created_at, updated_at
     FROM crm_lead_status
     ORDER BY sort_order ASC, id ASC`,
    { type: QueryTypes.SELECT },
  );

  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const body = await request.json() as {
    name?: string;
    badge_class?: string;
    kanban_accent_class?: string;
    kanban_tint_class?: string;
    uses_p_priority_scale?: number;
    is_enabled?: number;
    sort_order?: number;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  try {
    await sequelize.query(
      `INSERT INTO crm_lead_status
         (name, badge_class, kanban_accent_class, kanban_tint_class, uses_p_priority_scale, is_enabled, sort_order)
       VALUES
         (:name, :badge_class, :kanban_accent_class, :kanban_tint_class, :uses_p_priority_scale, :is_enabled, :sort_order)`,
      {
        replacements: {
          name: body.name.trim(),
          badge_class: body.badge_class || 'bg-gray-100 text-gray-800',
          kanban_accent_class: body.kanban_accent_class || 'bg-slate-400',
          kanban_tint_class: body.kanban_tint_class || 'border-slate-200 bg-slate-50/70',
          uses_p_priority_scale: body.uses_p_priority_scale ?? 0,
          is_enabled: body.is_enabled ?? 1,
          sort_order: body.sort_order ?? 0,
        },
        type: QueryTypes.INSERT,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Duplicate entry')) {
      return NextResponse.json({ error: `"${body.name}" already exists` }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
