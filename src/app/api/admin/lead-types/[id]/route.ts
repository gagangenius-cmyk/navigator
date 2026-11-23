import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isCeo } from '@/lib/roleChecks';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['admin.access']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const id = Number((await params).id);
  const body = await request.json() as { name?: string; description?: string | null; is_enabled?: number; sort_order?: number };

  const [existing] = await sequelize.query<{ name: string }>(
    'SELECT name FROM crm_lead_type WHERE id = :id',
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!existing) return NextResponse.json({ error: 'Lead type not found' }, { status: 404 });

  const fields: string[] = [];
  const replacements: Record<string, unknown> = { id };
  let newName: string | null = null;
  if ('name' in body) {
    newName = String(body.name || '').trim();
    if (!newName) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (newName.length > 100) return NextResponse.json({ error: 'name must be 100 characters or fewer' }, { status: 400 });
    fields.push('name = :name');
    replacements.name = newName;
  }
  if ('description' in body) { fields.push('description = :description'); replacements.description = body.description?.toString().trim() || null; }
  if ('is_enabled' in body) { fields.push('is_enabled = :is_enabled'); replacements.is_enabled = body.is_enabled ? 1 : 0; }
  if ('sort_order' in body) { fields.push('sort_order = :sort_order'); replacements.sort_order = Number(body.sort_order) || 0; }
  if (!fields.length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

  try {
    await sequelize.query(`UPDATE crm_lead_type SET ${fields.join(', ')} WHERE id = :id`, { replacements, type: QueryTypes.UPDATE });
    // Leads store the type by name, so a rename carries the existing leads along.
    if (newName && newName !== existing.name) {
      await sequelize.query(
        'UPDATE crm_forum_leads SET lead_type = :to WHERE lead_type = :from',
        { replacements: { to: newName, from: existing.name }, type: QueryTypes.UPDATE },
      );
    }
  } catch (error: unknown) {
    const e = error as { name?: string; parent?: { code?: string }; original?: { code?: string } };
    if (e?.name === 'SequelizeUniqueConstraintError' || e?.parent?.code === 'ER_DUP_ENTRY' || e?.original?.code === 'ER_DUP_ENTRY') return NextResponse.json({ error: `"${newName}" already exists` }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['admin.access']);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth)) return NextResponse.json({ error: 'Only the CEO can delete records' }, { status: 403 });
  await ensureDB();

  const id = Number((await params).id);
  const [row] = await sequelize.query<{ name: string }>('SELECT name FROM crm_lead_type WHERE id = :id', { replacements: { id }, type: QueryTypes.SELECT });
  if (!row) return NextResponse.json({ error: 'Lead type not found' }, { status: 404 });
  const [{ n }] = await sequelize.query<{ n: number }>(
    'SELECT COUNT(*) AS n FROM crm_forum_leads WHERE lead_type = :name',
    { replacements: { name: row.name }, type: QueryTypes.SELECT },
  );
  if (Number(n) > 0) {
    return NextResponse.json({ error: `${n} lead(s) use "${row.name}". Disable it instead, or move those leads to another type first.` }, { status: 409 });
  }
  await sequelize.query('DELETE FROM crm_lead_type WHERE id = :id', { replacements: { id }, type: QueryTypes.DELETE });
  return NextResponse.json({ success: true });
}
