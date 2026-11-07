import { NextRequest, NextResponse } from 'next/server';
import { buildDailyWork } from '@/lib/dailyLeadWork';
import { resolveWorkTarget } from '@/lib/dailyWorkTarget';

/**
 * GET /api/admin/dashboard/daily-work?date=YYYY-MM-DD&days=1|7|14|30&employeeId=
 * Per Dubai day / last 7-30 days: leads worked, status changes, remarks, follow-ups, appointments, how many leads
 * moved into each status, and the current by-status snapshot (see lib/dailyLeadWork.ts).
 * A counselor always sees their own numbers; Branch Manager (own branch) / CEO may pass employeeId.
 */

export async function GET(request: NextRequest) {
  try {
    const target = await resolveWorkTarget(request);
    if (target instanceof NextResponse) return target;
    const data = await buildDailyWork(target.employeeId, target.endDate, target.days);
    // The per-lead rows (which lead moved from which status to which) are only sent when asked for (?detail=1, the
    // Lead Status report page); the dashboard widget doesn't need them.
    const wantsDetail = new URL(request.url).searchParams.get('detail') === '1';
    const { statusChanges, ...widget } = data;
    return NextResponse.json({ success: true, data: wantsDetail ? { ...widget, statusChanges: statusChanges.slice(0, 3000) } : widget });
  } catch (error) {
    console.error('Error building daily work report:', error);
    return NextResponse.json({ success: false, error: 'Failed to load the daily work report' }, { status: 500 });
  }
}
