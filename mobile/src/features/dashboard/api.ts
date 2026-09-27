import { api } from '@/services/api/client';
import { toIsoDate } from '@/utils/format';

export interface NamedCount {
  name: string;
  value: number;
}

export interface DashboardAppointment {
  id: number;
  date: string | null;
  appointtime: string | null;
  leadid: number;
  done: number | null;
  not_done: number | null;
  fname: string | null;
  lname: string | null;
  phone: string | null;
  mobile: string | null;
  counselorName: string | null;
}

export interface DashboardFollowUp {
  id: number;
  lead_id: number;
  reminder_date: string;
  message: string | null;
  status: string;
  fname: string | null;
  lname: string | null;
  phone: string | null;
  mobile: string | null;
}

export interface Leaderboard {
  name?: string;
  branch?: string;
  leads: number;
  conversion: string;
}

/** The flat stats block of GET /api/admin/dashboard (also spread onto the response root). */
export interface DashboardStats {
  roleCategory: string;
  totalLeads: number;
  todayLeads: number;
  monthLeads: number;
  convertedLeads: number;
  pendingFollowups: number;
  todayAppointments: number;
  pendingAppointments: number;
  totalEmployees: number;
  totalClients: number;
  totalRevenue: number;
  totalPaidAmount: number;
  totalBalance: number;
  activeOperations: number;
  conversionRate: number;
  statusBreakdown: NamedCount[];
  priorityBreakdown: NamedCount[];
  sourceBreakdown: NamedCount[];
  branchPerformance: Leaderboard[];
  topEmployees: Leaderboard[];
  monthTrend: {
    thisMonthLeads: number;
    lastMonthLeads: number;
    thisMonthConverted: number;
    lastMonthConverted: number;
    thisMonthAppointments: number;
    lastMonthAppointments: number;
  };
}

export interface DashboardResponse extends DashboardStats {
  data: {
    todayAppointments: DashboardAppointment[];
    todayFollowUps: DashboardFollowUp[];
  };
}

export type DashboardRange = 'month' | 'all';

export function fetchDashboard(range: DashboardRange): Promise<DashboardResponse> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return api.get<DashboardResponse>('/api/admin/dashboard', {
    query: range === 'month' ? { dateFrom: toIsoDate(from), dateTo: toIsoDate(to) } : undefined,
  });
}

/** Percentage change from `previous` to `current`; null when there is no baseline. */
export function percentChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}
