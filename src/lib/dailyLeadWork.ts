import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { dubaiDayOfUtc, dubaiDayRangeUtc } from '@/lib/dubaiDate';

// "What did this person do on their leads" - built from the lead activity log (crm_remarks), which every status
// change / remark / follow-up / appointment writes to. A day is a Dubai calendar day (the log stores UTC).
// Shared by the dashboard widget (GET /api/admin/dashboard/daily-work) and the Excel/CSV export.

export const WORK_ACTIONS = ['status_changed', 'remark_added', 'remark_edited', 'followup_added', 'appointment_booked', 'whatsapp_sent'];
export const ALLOWED_DAYS = [1, 7, 14, 30];
const ROW_LIMIT = 20000;

interface LogRow {
  id: number;
  lead_id: number;
  action: string;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
  fname: string | null;
  lname: string | null;
  phone: string | null;
  mobile: string | null;
  currentStatus: string | null;
}

export interface StatusChangeRow {
  date: string;
  time: string;
  leadId: number;
  leadName: string;
  phone: string;
  from: string;
  to: string;
  currentStatus: string;
}

export interface DailyWork {
  employeeId: number;
  range: { from: string; to: string; days: number };
  totals: { leadsWorked: number; statusChanges: number; remarks: number; followUps: number; appointments: number; whatsapp: number };
  byStatus: Array<{ status: string; leads: number; changes: number }>;
  moves: Array<{ move: string; count: number }>;
  daily: Array<{ date: string; leadsWorked: number; statusChanges: number; remarks: number; followUps: number; appointments: number }>;
  snapshot: Array<{ status: string; count: number }>;
  snapshotTotal: number;
  statusChanges: StatusChangeRow[];
  truncated: boolean;
}

export async function buildDailyWork(employeeId: number, endDate: string, days: number): Promise<DailyWork> {
  const { startUtc, endUtc, dates } = dubaiDayRangeUtc(endDate, days);

  const rows = await sequelize.query<LogRow>(
    `SELECT r.id, r.lead_id, r.action, r.previous_value, r.new_value, r.created_at,
            l.fname, l.lname, l.phone, l.mobile, l.status AS currentStatus
     FROM crm_remarks r
     LEFT JOIN crm_forum_leads l ON l.id = r.lead_id
     WHERE r.actor_id = :employeeId AND r.action IN (:actions) AND r.created_at >= :startUtc AND r.created_at < :endUtc
     ORDER BY r.created_at ASC
     LIMIT ${ROW_LIMIT}`,
    { replacements: { employeeId, actions: WORK_ACTIONS, startUtc, endUtc }, type: QueryTypes.SELECT },
  );

  const totals = { leadsWorked: new Set<number>(), statusChanges: 0, remarks: 0, followUps: 0, appointments: 0, whatsapp: 0 };
  const byStatus = new Map<string, { leads: Set<number>; changes: number }>();
  const moves = new Map<string, number>();
  const daily = new Map(dates.map((d) => [d, { leads: new Set<number>(), statusChanges: 0, remarks: 0, followUps: 0, appointments: 0 }]));
  const statusChanges: StatusChangeRow[] = [];

  for (const row of rows) {
    const dayKey = dubaiDayOfUtc(row.created_at);
    const day = daily.get(dayKey);
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
        const stamp = new Date(new Date(`${String(row.created_at).replace(' ', 'T')}Z`).getTime() + 4 * 3600_000).toISOString();
        statusChanges.push({
          date: dayKey,
          time: stamp.slice(11, 16),
          leadId: row.lead_id,
          leadName: `${row.fname || ''} ${row.lname || ''}`.trim() || `Lead #${row.lead_id}`,
          phone: row.mobile || row.phone || '',
          from,
          to,
          currentStatus: row.currentStatus || '',
        });
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

  return {
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
    statusChanges,
    truncated: rows.length >= ROW_LIMIT,
  };
}
