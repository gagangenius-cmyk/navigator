import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { canManageMailboxes } from '@/lib/mailboxes';

// Lead picker for "link this email to a lead". Counselors only see leads
// assigned to them; the CEO sees all.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;
  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (q.length < 2) return NextResponse.json({ success: true, data: [] });
  const scope = canManageMailboxes(auth) ? '' : 'AND (l.Counsilor = :userId OR l.assignTo = :userId)';
  const rows = await sequelize.query(
    `SELECT l.id, CONCAT_WS(' ', l.fname, l.lname) AS name, l.email, l.phone
     FROM crm_forum_leads l
     WHERE (CONCAT_WS(' ', l.fname, l.lname) LIKE :q OR l.email LIKE :q OR l.phone LIKE :q OR l.id = :id) ${scope}
     ORDER BY l.id DESC LIMIT 15`,
    { replacements: { q: `%${q}%`, id: Number(q) || 0, userId: auth.id }, type: QueryTypes.SELECT },
  );
  return NextResponse.json({ success: true, data: rows });
}
