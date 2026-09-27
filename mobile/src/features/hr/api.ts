import { api } from '@/services/api/client';

export interface AttendanceRow {
  attendance_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  overtime_hours?: number;
}

export interface BreakRow {
  break_id: string;
  break_type: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
}

export interface AttendanceResponse {
  today: AttendanceRow | null;
  breaks: BreakRow[];
  history: AttendanceRow[];
}

export const BREAK_TYPES = ['Lunch Break', 'Prayer Break', 'Short Break'] as const;
export type BreakType = (typeof BREAK_TYPES)[number];

export function fetchAttendance(limit = 14): Promise<AttendanceResponse> {
  return api.get<AttendanceResponse>('/api/hr/self/attendance', { query: { limit } });
}

export interface TeamAttendanceRow {
  attendance_id: string;
  employee_id: string;
  employee_name: string | null;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  overtime_hours: number | null;
  notes: string | null;
}

/**
 * Company/branch-wide attendance for CEO and HR (hr.view or hr.reports.attendance) -
 * scoped server-side to the caller's branch unless they can view all branches.
 */
export async function fetchTeamAttendance(dateFrom: string, dateTo: string): Promise<TeamAttendanceRow[]> {
  const response = await api.get<{ data: TeamAttendanceRow[] }>('/api/admin/hr/attendance', {
    query: { date_from: dateFrom, date_to: dateTo, limit: 200 },
    requires: ['hr.view', 'hr.reports.attendance'],
  });
  return response.data ?? [];
}

export function clockIn(): Promise<unknown> {
  return api.post('/api/hr/self/attendance', { action: 'clock-in' });
}
export function clockOut(): Promise<unknown> {
  return api.post('/api/hr/self/attendance', { action: 'clock-out' });
}
export function startBreak(breakType: BreakType): Promise<unknown> {
  return api.post('/api/hr/self/attendance', { action: 'break-start', break_type: breakType });
}
export function endBreak(): Promise<unknown> {
  return api.post('/api/hr/self/attendance', { action: 'break-end' });
}

export interface LeaveBalance {
  leave_type: string;
  entitlement_days: number;
  used_days: number;
  pending_days: number;
  remaining_days: number;
}

export interface LeaveRequest {
  leave_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  status: string;
  reason: string | null;
  applied_at: string;
}

export interface LeaveResponse {
  requests: LeaveRequest[];
  balances: LeaveBalance[];
  leaveTypes: string[];
}

export function fetchLeave(): Promise<LeaveResponse> {
  return api.get<LeaveResponse>('/api/hr/self/leave');
}

export async function previewLeaveDays(startDate: string, endDate: string): Promise<number> {
  const response = await api.get<{ daysRequested: number }>('/api/hr/self/leave/preview', {
    query: { start_date: startDate, end_date: endDate },
  });
  return response.daysRequested;
}

export interface ApplyLeaveInput {
  leave_type: string;
  start_date: string;
  end_date: string;
  reason?: string;
}

export function applyLeave(input: ApplyLeaveInput): Promise<unknown> {
  return api.post('/api/hr/self/leave', { ...input, reason: input.reason?.trim() || undefined });
}

export interface Payslip {
  payslip_id: string;
  pay_period: string;
  gross_salary: number;
  net_salary: number;
  currency_code: string;
  signed_url: string;
  signed_url_expires_at: string;
  generated_at: string;
}

export async function fetchPayslips(): Promise<Payslip[]> {
  const response = await api.get<{ payslips: Payslip[] }>('/api/admin/hr/payslips', { requires: ['hr.self', 'hr.payroll'] });
  return response.payslips ?? [];
}
