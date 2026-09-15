import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isCeo } from '@/lib/roleChecks';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request, ['admin.access']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const { id } = await params;
  const body = await request.json() as {
    name?: string;
    badge_class?: string;
    kanban_accent_class?: string;
    kanban_tint_class?: string;
    uses_p_priority_scale?: number;
    is_enabled?: number;
    sort_order?: number;
  };

  const fields: string[] = [];
  const replacements: Record<string, unknown> = { id: Number(id) };

  const allowed = [
    'name', 'badge_class', 'kanban_accent_class', 'kanban_tint_class',
    'uses_p_priority_scale', 'is_enabled', 'sort_order',
  ] as const;

  for (const key of allowed) {
    if (key in body) {
      fields.push(`${key} = :${key}`);
      replacements[key] = (body as Record<string, unknown>)[key] ?? null;
    }
  }

  if (fields.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  await sequelize.query(
    `UPDATE crm_lead_status SET ${fields.join(', ')}, updated_at = NOW() WHERE id = :id`,
    { replacements, type: QueryTypes.UPDATE },
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAuth(request, ['admin.access']);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth)) {
    return NextResponse.json({ error: 'Only the CEO can delete records' }, { status: 403 });
  }
  await ensureDB();

  const { id } = await params;
  await sequelize.query(
    `DELETE FROM crm_lead_status WHERE id = :id`,
    { replacements: { id: Number(id) }, type: QueryTypes.DELETE },
  );

  return NextResponse.json({ success: true });
}
