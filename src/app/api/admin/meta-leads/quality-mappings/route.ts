import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access', 'marketing.manage']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const rows = await sequelize.query(
    `SELECT id, quality_label, meta_event_name, meta_value, meta_currency,
            is_enabled, sort_order, created_at, updated_at
     FROM crm_meta_quality_mappings
     ORDER BY sort_order ASC, id ASC`,
    { type: QueryTypes.SELECT },
  );

  return NextResponse.json({ data: rows });
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access', 'marketing.manage']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const body = await request.json() as {
    quality_label?: string;
    meta_event_name?: string;
    meta_value?: number | null;
    meta_currency?: string | null;
    is_enabled?: number;
    sort_order?: number;
  };

  const { quality_label, meta_event_name } = body;
  if (!quality_label?.trim() || !meta_event_name?.trim()) {
    return NextResponse.json({ error: 'quality_label and meta_event_name are required' }, { status: 400 });
  }

  try {
    await sequelize.query(
      `INSERT INTO crm_meta_quality_mappings
         (quality_label, meta_event_name, meta_value, meta_currency, is_enabled, sort_order)
       VALUES
         (:quality_label, :meta_event_name, :meta_value, :meta_currency, :is_enabled, :sort_order)`,
      {
        replacements: {
          quality_label: quality_label.trim(),
          meta_event_name: meta_event_name.trim(),
          meta_value: body.meta_value ?? null,
          meta_currency: body.meta_currency ?? null,
          is_enabled: body.is_enabled ?? 1,
          sort_order: body.sort_order ?? 0,
        },
        type: QueryTypes.INSERT,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Duplicate entry')) {
      return NextResponse.json({ error: `"${quality_label}" already exists` }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
