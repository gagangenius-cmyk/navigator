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
  // usage = how many leads currently carry each type (shown on the config page).
  const rows = await sequelize.query(
    `SELECT t.id, t.name, t.description, t.is_enabled, t.sort_order, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM crm_forum_leads l WHERE l.lead_type = t.name) AS lead_count
     FROM crm_lead_type t
     ORDER BY t.sort_order ASC, t.id ASC`,
    { type: QueryTypes.SELECT },
  );
  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const body = await request.json() as { name?: string; description?: string; is_enabled?: number; sort_order?: number };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (name.length > 100) return NextResponse.json({ error: 'name must be 100 characters or fewer' }, { status: 400 });

  try {
    await sequelize.query(
      `INSERT INTO crm_lead_type (name, description, is_enabled, sort_order)
       VALUES (:name, :description, :is_enabled, :sort_order)`,
      {
        replacements: {
          name,
          description: body.description?.trim() || null,
          is_enabled: body.is_enabled ?? 1,
          sort_order: body.sort_order ?? 0,
        },
        type: QueryTypes.INSERT,
      },
    );
  } catch (error: unknown) {
    const e = error as { name?: string; parent?: { code?: string }; original?: { code?: string } };
    if (e?.name === 'SequelizeUniqueConstraintError' || e?.parent?.code === 'ER_DUP_ENTRY' || e?.original?.code === 'ER_DUP_ENTRY') {
      return NextResponse.json({ error: `"${name}" already exists` }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ success: true }, { status: 201 });
}
