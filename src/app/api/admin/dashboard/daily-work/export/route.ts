import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { buildDailyWork, buildDailySheet } from '@/lib/dailyLeadWork';
import { resolveWorkTarget } from '@/lib/dailyWorkTarget';
import { dubaiToday } from '@/lib/dubaiDate';
import { logDataAccess } from '@/lib/dataAccessAudit';

/**
 * GET /api/admin/dashboard/daily-work/export?date=&days=1|7|14|30&format=xlsx|csv&employeeId=
 * The counselor's own lead status report for a day / week / month:
 *   xlsx -> Summary, Status changes (one row per lead moved), By status, Day by day, My leads (every lead
 *           currently assigned, with its status)
 *   csv  -> the Status changes rows (opens in Excel)
 * Same access rule as the dashboard widget: a counselor can only export their own work.
 */

const MY_LEADS_LIMIT = 10000;

const PHONE_LIKE = /^\+?\d[\d\s().-]{5,}$/;

const csvCell = (value: unknown) => {
  const text = String(value ?? '');
  // A phone number is written as ="+971..." so Excel keeps it as text (a bare +971... is read as a number / formula).
  if (PHONE_LIKE.test(text)) return `"=""${text}"""`;
  // Neutralise spreadsheet formulas in other user-entered text (names, statuses): =, +, -, @ at the start.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(request: NextRequest) {
  try {
    const target = await resolveWorkTarget(request);
    if (target instanceof NextResponse) return target;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

    const data = await buildDailyWork(target.employeeId, target.endDate, target.days);
    const [employee] = await sequelize.query<{ name: string }>(
      'SELECT name FROM crm_employee WHERE id = :id LIMIT 1',
      { replacements: { id: target.employeeId }, type: QueryTypes.SELECT },
    );
    const who = employee?.name || `Employee ${target.employeeId}`;
    const period = data.range.from === data.range.to ? data.range.from : `${data.range.from}_to_${data.range.to}`;
    const baseName = `lead-status-report_${who.replace(/[^a-zA-Z0-9]+/g, '-')}_${period}`;

    void logDataAccess({ userId: target.employeeId, entityType: 'lead_status_report', entityId: period, action: 'export' });

    if (format === 'csv') {
      const header = ['Date', 'Time (Dubai)', 'Lead ID', 'Lead name', 'Phone', 'Previous status', 'New status', 'Current status'];
      const lines = [header.map(csvCell).join(',')].concat(
        data.statusChanges.map((r) => [r.date, r.time, r.leadId, r.leadName, r.phone, r.from, r.to, r.currentStatus].map(csvCell).join(',')),
      );
      // UTF-8 BOM so Excel reads names/Arabic correctly.
      return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${baseName}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const myLeads = await sequelize.query<Record<string, string | number | null>>(
      `SELECT l.id, TRIM(CONCAT_WS(' ', l.fname, NULLIF(l.mname, ''), l.lname)) AS name, COALESCE(l.mobile, l.phone) AS phone, l.email,
              COALESCE(NULLIF(TRIM(l.status), ''), '(no status)') AS status, l.priority, l.market_source AS source,
              DATE(l.created) AS created, l.last_updated AS lastUpdated
       FROM crm_forum_leads l
       WHERE (l.assignTo = :employeeId OR l.Counsilor = :employeeId)
       ORDER BY l.status, l.id DESC
       LIMIT ${MY_LEADS_LIMIT}`,
      { replacements: { employeeId: target.employeeId }, type: QueryTypes.SELECT },
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Global Navigator CRM';
    wb.created = new Date();

    const addSheet = (name: string, columns: Array<{ header: string; key: string; width: number }>, rows: Array<Record<string, unknown>>) => {
      const ws = wb.addWorksheet(name);
      ws.columns = columns;
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      // exceljs writes strings as text cells (never formulas), so no escaping is needed here.
      rows.forEach((r) => ws.addRow(r));
      return ws;
    };

    // First sheet: the one-column daily report (date | counselor first name, then FTD / MTD figures) in the format
    // counselors send to their manager. Day = the last day of the chosen period.
    const sheet = await buildDailySheet(target.employeeId, data.range.to);
    const daily = wb.addWorksheet('Daily report');
    daily.columns = [{ width: 24 }, { width: 14 }];
    const [, mm, dd] = data.range.to.split('-').map(Number);
    const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mm - 1];
    const header = daily.addRow([`${dd}-${monthName}`, who.split(' ')[0]]);
    sheet.rows.forEach((r) => daily.addRow([r.label, r.value]));
    daily.eachRow((row, rowNumber) => {
      row.eachCell((cell, col) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        cell.alignment = { horizontal: rowNumber === 1 || col === 2 ? 'right' : 'left' };
        if (rowNumber > 1 && col === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
        if (rowNumber > 1 && col === 2) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };
      });
    });
    header.font = { bold: false };
    daily.getCell('A16').value = 'FTD = for the day, MTD = month to date (Dubai days). Calls = leads worked that day; Connected = leads moved into a talked-to status; DNP = Not answered / DNP / Could not connect; Counselling = appointments; Rev = payments received on the leads of the counselor.';
    daily.getCell('A16').font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };

    addSheet('Summary', [{ header: 'Item', key: 'item', width: 34 }, { header: 'Value', key: 'value', width: 30 }], [
      { item: 'Counselor', value: who },
      { item: 'Period (Dubai days)', value: data.range.from === data.range.to ? data.range.from : `${data.range.from} to ${data.range.to}` },
      { item: 'Generated', value: `${dubaiToday()} (Dubai)` },
      { item: 'Leads worked', value: data.totals.leadsWorked },
      { item: 'Status changes', value: data.totals.statusChanges },
      { item: 'Remarks', value: data.totals.remarks },
      { item: 'Follow-ups set', value: data.totals.followUps },
      { item: 'Appointments booked', value: data.totals.appointments },
      { item: 'WhatsApp sent', value: data.totals.whatsapp },
      { item: 'Leads assigned right now', value: data.snapshotTotal },
    ]);
    addSheet('Status changes', [
      { header: 'Date', key: 'date', width: 12 }, { header: 'Time (Dubai)', key: 'time', width: 13 }, { header: 'Lead ID', key: 'leadId', width: 9 },
      { header: 'Lead name', key: 'leadName', width: 28 }, { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Previous status', key: 'from', width: 22 }, { header: 'New status', key: 'to', width: 22 }, { header: 'Current status', key: 'currentStatus', width: 22 },
    ], data.statusChanges as unknown as Array<Record<string, unknown>>);
    addSheet('By status', [{ header: 'Moved into status', key: 'status', width: 28 }, { header: 'Leads', key: 'leads', width: 10 }, { header: 'Changes', key: 'changes', width: 10 }], data.byStatus);
    addSheet('Day by day', [
      { header: 'Date', key: 'date', width: 12 }, { header: 'Leads worked', key: 'leadsWorked', width: 14 }, { header: 'Status changes', key: 'statusChanges', width: 15 },
      { header: 'Remarks', key: 'remarks', width: 10 }, { header: 'Follow-ups', key: 'followUps', width: 12 }, { header: 'Appointments', key: 'appointments', width: 14 },
    ], data.daily);
    addSheet('My leads now', [
      { header: 'Lead ID', key: 'id', width: 9 }, { header: 'Name', key: 'name', width: 28 }, { header: 'Phone', key: 'phone', width: 18 }, { header: 'Email', key: 'email', width: 30 },
      { header: 'Status', key: 'status', width: 22 }, { header: 'Priority', key: 'priority', width: 10 }, { header: 'Source', key: 'source', width: 18 },
      { header: 'Created', key: 'created', width: 12 }, { header: 'Last updated', key: 'lastUpdated', width: 14 },
    ], myLeads);

    const buffer = await wb.xlsx.writeBuffer();
    return new NextResponse(buffer as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${baseName}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Error exporting the lead status report:', error);
    return NextResponse.json({ success: false, error: 'Failed to export the report' }, { status: 500 });
  }
}
