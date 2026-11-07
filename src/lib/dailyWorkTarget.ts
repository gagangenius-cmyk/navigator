import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { connectDB, sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isBranchManagerOrCeo, isCeo } from '@/lib/roleChecks';
import { dubaiToday } from '@/lib/dubaiDate';
import { ALLOWED_DAYS } from '@/lib/dailyLeadWork';

/**
 * Whose work, which Dubai day, how many days - from the query string, with the access rule: a counselor always gets
 * their own numbers; a Branch Manager (own branch) / CEO may pass employeeId.
 */
export async function resolveWorkTarget(
  request: NextRequest,
): Promise<{ employeeId: number; endDate: string; days: number } | NextResponse> {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;

  await connectDB();
  const { searchParams } = new URL(request.url);
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('date') || '') ? String(searchParams.get('date')) : dubaiToday();
  const requestedDays = Number(searchParams.get('days') || 1);
  const days = ALLOWED_DAYS.includes(requestedDays) ? requestedDays : 1;

  let employeeId = Number(auth.id);
  const requestedEmployee = Number(searchParams.get('employeeId'));
  if (requestedEmployee && requestedEmployee !== employeeId) {
    if (isCeo(auth)) {
      employeeId = requestedEmployee;
    } else if (isBranchManagerOrCeo(auth)) {
      const [emp] = await sequelize.query<{ branch: number | null }>(
        'SELECT branch FROM crm_employee WHERE id = :id LIMIT 1',
        { replacements: { id: requestedEmployee }, type: QueryTypes.SELECT },
      );
      if (!emp || Number(emp.branch) !== Number(auth.branch || 0)) {
        return NextResponse.json({ success: false, error: 'You can only view your own branch' }, { status: 403 });
      }
      employeeId = requestedEmployee;
    } else {
      return NextResponse.json({ success: false, error: 'You can only view your own work' }, { status: 403 });
    }
  }
  return { employeeId, endDate, days };
}
