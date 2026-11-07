import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { connectDB, sequelize } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isBranchManagerOrCeo, isCeo } from '@/lib/roleChecks';
import { dubaiDayOfUtc, dubaiDayRangeUtc, dubaiToday } from '@/lib/dubaiDate';

/**
 * GET /api/admin/dashboard/daily-work?date=YYYY-MM-DD&days=1|7|14|30&employeeId=
 *
 * "What did this counselor actually do on their leads": built from the lead activity log
 * (crm_remarks), which every status change / remark / follow-up / appointment writes to. A day is a
 * Dubai calendar day (the log stores UTC), so "today" is correct between 00:00 and 04:00 too.
 *  - leadsWorked: distinct leads the person touched
 *  - byStatus:    distinct leads moved INTO each status in the period (+ number of changes)
 *  - daily:       the same counters per day
 *  - snapshot:    the leads currently assigned to them, grouped by status (sums to Assigned Leads)
 * A counselor always sees their own numbers; Branch Manager (own branch) / CEO may pass employeeId.
 */

const WORK_ACTIONS = ['status_changed', 'remark_added', 'remark_edited', 'followup_added', 'appointment_booked', 'whatsapp_sent'];
const ALLOWED_DAYS = [1, 7, 14, 30];

type LogRow = { lead_id: number; action: string; previous_value: string | null; new_value: string | null; created_at: string };

export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (isAuthError(auth)) return auth;

  try {
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

    const { startUtc, endUtc, dates } = dubaiDayRangeUtc(endDate, days);

    const rows = await sequelize.query<LogRow>(
      `SELECT lead_id, action, previous_value, new_value, created_at
       FROM crm_remarks
       WHERE actor_id = :employeeId AND action IN (:actions) AND created_at >= :startUtc AND created_at < :endUtc
       ORDER BY created_at ASC
       LIMIT 20000`,
      { replacements: { employeeId, actions: WORK_ACTIONS, startUtc, endUtc }, type: QueryTypes.SELECT },
    );

    const totals = { leadsWorked: new Set<number>(), statusChanges: 0, remarks: 0, followUps: 0, appointments: 0, whatsapp: 0 };
    const byStatus = new Map<string, { leads: Set<number>; changes: number }>();
    const moves = new Map<string, number>();
    const daily = new Map(dates.map((d) => [d, { leads: new Set<number>(), statusChanges: 0, remarks: 0, followUps: 0, appointments: 0 }]));

    for (const row of rows) {
      const day = daily.get(dubaiDayOfUtc(row.created_at));
      totals.leadsWorked.add(row.lead_id);
      day?.leads.add(row.lead_id);
      switch (row.action) {
        case 'status_changed': {
          const to = (row.new_value || '').trim() || '(no status)';
          const from = (row.previous_value || '').trim() || '(no status)';
          totals.statusChanges += 1;
          if (day) day.statusChanges += 1;
          const bucket = byStatus.get(to) || { leads: new Set<number>(), changes: 0 };
          bucket.leads.add(row.lead_id);
          bucket.changes += 1;
          byStatus.set(to, bucket);
          moves.set(`${from} → ${to}`, (moves.get(`${from} → ${to}`) || 0) + 1);
          break;
        }
        case 'remark_added':
        case 'remark_edited':
          totals.remarks += 1;
          if (day) day.remarks += 1;
          break;
        case 'followup_added':
          totals.followUps += 1;
          if (day) day.followUps += 1;
          break;
        case 'appointment_booked':
          totals.appointments += 1;
          if (day) day.appointments += 1;
          break;
        case 'whatsapp_sent':
          totals.whatsapp += 1;
          break;
        default:
          break;
      }
    }

    const snapshotRows = await sequelize.query<{ status: string; count: number }>(
      `SELECT COALESCE(NULLIF(TRIM(l.status), ''), '(no status)') AS status, COUNT(*) AS count
       FROM crm_forum_leads l
       WHERE (l.assignTo = :employeeId OR l.Counsilor = :employeeId)
       GROUP BY COALESCE(NULLIF(TRIM(l.status), ''), '(no status)')
       ORDER BY count DESC`,
      { replacements: { employeeId }, type: QueryTypes.SELECT },
    );

    return NextResponse.json({
      success: true,
      data: {
        employeeId,
        range: { from: dates[0], to: dates[dates.length - 1], days },
        totals: { ...totals, leadsWorked: totals.leadsWorked.size },
        byStatus: [...byStatus.entries()]
          .map(([status, v]) => ({ status, leads: v.leads.size, changes: v.changes }))
          .sort((a, b) => b.leads - a.leads || b.changes - a.changes),
        moves: [...moves.entries()].map(([move, count]) => ({ move, count })).sort((a, b) => b.count - a.count).slice(0, 12),
        daily: dates.map((date) => {
          const d = daily.get(date)!;
          return { date, leadsWorked: d.leads.size, statusChanges: d.statusChanges, remarks: d.remarks, followUps: d.followUps, appointments: d.appointments };
        }),
        snapshot: snapshotRows.map((r) => ({ status: r.status, count: Number(r.count) })),
        snapshotTotal: snapshotRows.reduce((sum, r) => sum + Number(r.count), 0),
        truncated: rows.length >= 20000,
      },
    });
  } catch (error) {
    console.error('Error building daily work report:', error);
    return NextResponse.json({ success: false, error: 'Failed to load the daily work report' }, { status: 500 });
  }
}
