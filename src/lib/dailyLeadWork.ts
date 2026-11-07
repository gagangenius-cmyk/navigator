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

// ---- The one-column "daily sheet" a counselor sends in (FTD = for the day, MTD = month to date) ----
const NO_CONTACT = new Set(['new', 'not_answered', 'not answered', 'dnp', 'could not connect', 'junk', '(no status)']);
const norm = (value: string | null | undefined) => (value || '').trim().toLowerCase();

export interface DailySheet {
  date: string;
  rows: Array<{ label: string; value: number; note?: string }>;
}

export async function buildDailySheet(employeeId: number, date: string): Promise<DailySheet> {
  const dayOfMonth = Number(date.slice(8, 10)) || 1;
  const day = dubaiDayRangeUtc(date, 1);
  const month = dubaiDayRangeUtc(date, dayOfMonth);
  const monthStart = month.dates[0];

  // Fresh leads = leads ASSIGNED to the counselor that day / this month. The assignment log says when (its new_value is
  // the employee's name); a lead that was created already assigned and has no assignment entry counts on its created day.
  const [emp] = await sequelize.query<{ name: string }>('SELECT name FROM crm_employee WHERE id = :employeeId LIMIT 1', {
    replacements: { employeeId }, type: QueryTypes.SELECT,
  });
  const assignedEvents = await sequelize.query<{ lead_id: number; created_at: string }>(
    `SELECT r.lead_id, r.created_at FROM crm_remarks r
     WHERE r.action = 'lead_assigned' AND r.new_value = :name AND r.created_at >= :monthStart AND r.created_at < :dayEnd
     ORDER BY r.created_at ASC`,
    { replacements: { name: emp?.name || '', monthStart: month.startUtc, dayEnd: day.endUtc }, type: QueryTypes.SELECT },
  );
  const createdOwn = await sequelize.query<{ id: number; created: string }>(
    `SELECT l.id, l.created FROM crm_forum_leads l
     WHERE (l.assignTo = :employeeId OR l.Counsilor = :employeeId) AND l.created >= :monthStart AND l.created < :dayEnd
       AND NOT EXISTS (SELECT 1 FROM crm_remarks r WHERE r.lead_id = l.id AND r.action = 'lead_assigned')`,
    { replacements: { employeeId, monthStart: month.startUtc, dayEnd: day.endUtc }, type: QueryTypes.SELECT },
  );
  const firstAssignedDay = new Map<number, string>();
  assignedEvents.forEach((r) => { if (!firstAssignedDay.has(r.lead_id)) firstAssignedDay.set(r.lead_id, dubaiDayOfUtc(r.created_at)); });
  createdOwn.forEach((r) => { if (!firstAssignedDay.has(r.id)) firstAssignedDay.set(r.id, dubaiDayOfUtc(r.created)); });
  const fresh = { ftd: [...firstAssignedDay.values()].filter((d) => d === date).length, mtd: firstAssignedDay.size };

  // The whole month so far; each entry is tagged with its Dubai day so FTD (that day) and MTD (month to date) come from
  // the same data.
  const log = await sequelize.query<{ lead_id: number; action: string; new_value: string | null; created_at: string }>(
    `SELECT r.lead_id, r.action, r.new_value, r.created_at FROM crm_remarks r
     WHERE r.actor_id = :employeeId AND r.action IN (:actions) AND r.created_at >= :monthStart AND r.created_at < :dayEnd`,
    { replacements: { employeeId, actions: WORK_ACTIONS, monthStart: month.startUtc, dayEnd: day.endUtc }, type: QueryTypes.SELECT },
  );
  // MTD = the sum of each day's distinct leads (a lead worked on two days counts on both), so it adds up the daily figures.
  const worked = { ftd: new Set<number>(), mtd: new Set<string>() };
  const connected = { ftd: new Set<number>(), mtd: new Set<string>() };
  // Hot / Warm / Cold / DNP / Junk are how many of the counselor's leads sit in that status at the END of the day
  // (today: right now). A past day is rebuilt from the status log: a lead that changed status after that day was in
  // the status it changed away from.
  const myLeads = await sequelize.query<{ id: number; status: string | null }>(
    'SELECT id, status FROM crm_forum_leads WHERE assignTo = :employeeId OR Counsilor = :employeeId',
    { replacements: { employeeId }, type: QueryTypes.SELECT },
  );
  const later = myLeads.length
    ? await sequelize.query<{ lead_id: number; previous_value: string | null }>(
      `SELECT r.lead_id, r.previous_value FROM crm_remarks r
       WHERE r.action = 'status_changed' AND r.created_at >= :dayEnd AND r.lead_id IN (:ids)
       ORDER BY r.created_at ASC, r.id ASC`,
      { replacements: { dayEnd: day.endUtc, ids: myLeads.map((l) => l.id) }, type: QueryTypes.SELECT },
    )
    : [];
  const statusAtEndOfDay = new Map<number, string>(myLeads.map((l) => [l.id, norm(l.status)]));
  const seenLater = new Set<number>();
  later.forEach((r) => {
    if (seenLater.has(r.lead_id)) return;
    seenLater.add(r.lead_id);
    statusAtEndOfDay.set(r.lead_id, norm(r.previous_value));
  });
  const inStatus = (statuses: string[]) => [...statusAtEndOfDay.values()].filter((value) => statuses.includes(value)).length;
  log.forEach((r) => {
    const dayKey = dubaiDayOfUtc(r.created_at);
    const isToday = dayKey === date;
    worked.mtd.add(`${dayKey}:${r.lead_id}`);
    if (isToday) worked.ftd.add(r.lead_id);
    if (r.action === 'status_changed' && !NO_CONTACT.has(norm(r.new_value))) {
      connected.mtd.add(`${dayKey}:${r.lead_id}`);
      if (isToday) connected.ftd.add(r.lead_id);
    }
  });

  const [counselling] = await sequelize.query<{ ftd: number; mtd: number }>(
    `SELECT SUM(a.date = :date) AS ftd, COUNT(*) AS mtd FROM appointments a
     WHERE a.counsilorid = :employeeId AND a.date >= :monthStart AND a.date <= :date`,
    { replacements: { employeeId, date, monthStart }, type: QueryTypes.SELECT },
  );

  const [revenue] = await sequelize.query<{ ftd: number | null; mtd: number | null }>(
    `SELECT SUM(CASE WHEN DATE(ph.date) = :date THEN ph.amount ELSE 0 END) AS ftd, SUM(ph.amount) AS mtd
     FROM crm_pay_history ph JOIN crm_forum_leads l ON l.id = ph.leadId
     WHERE (l.assignTo = :employeeId OR l.Counsilor = :employeeId) AND DATE(ph.date) >= :monthStart AND DATE(ph.date) <= :date
       AND COALESCE(LOWER(ph.status), '') NOT IN ('rejected', 'cancelled', 'canceled', 'refunded')`,
    { replacements: { employeeId, date, monthStart }, type: QueryTypes.SELECT },
  );

  return {
    date,
    rows: [
      { label: 'Fresh Lead FTD:-', value: Number(fresh.ftd || 0), note: 'fresh leads assigned today' },
      { label: 'Fresh Lead MTD:-', value: Number(fresh.mtd || 0), note: 'fresh leads assigned for this month till date' },
      { label: 'Calls FTD:-', value: worked.ftd.size, note: 'total calls done for today' },
      { label: 'Connected FTD:-', value: connected.ftd.size, note: 'connected calls' },
      { label: 'Hot:-', value: inStatus(['hot']), note: 'very interested' },
      { label: 'Warm:-', value: inStatus(['warm']), note: 'interested' },
      { label: 'Cold:-', value: inStatus(['cold']), note: 'not very interested' },
      { label: 'DNP:-', value: inStatus(['dnp', 'not_answered', 'not answered']), note: 'did not pick the call' },
      { label: 'Junk:-', value: inStatus(['junk']), note: 'junk / invalid leads' },
      { label: 'Counselling FTD:-', value: Number(counselling?.ftd || 0), note: 'for the day how many counselling done' },
      { label: 'Counselling MTD:-', value: Number(counselling?.mtd || 0), note: 'for the month how many counselling done' },
      { label: 'Rev FTD:-', value: Math.round(Number(revenue?.ftd || 0)), note: 'revenue for the day achieved' },
      { label: 'Rev MTD:-', value: Math.round(Number(revenue?.mtd || 0)), note: 'revenue for the month achieved' },
    ],
  };
}
