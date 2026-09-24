import { api, toPage, type Page, type RawPagination } from '@/services/api/client';
import type { SessionUser } from '@/features/auth/types';
import type {
  Appointment,
  FollowUp,
  LeadActivity,
  LeadDetail,
  LeadFilters,
  LeadListItem,
  LeadStatusOption,
  PoolLead,
} from './types';

// ---------- leads -------------------------------------------------------

export async function fetchLeads(filters: LeadFilters, page: number, limit = 20): Promise<Page<LeadListItem>> {
  // /api/leads answers `{ leads, pagination: { pages } }` - unlike the other list
  // endpoints - and scopes rows by the caller's role server-side.
  const response = await api.get<{ leads: LeadListItem[]; pagination?: RawPagination }>('/api/leads', {
    query: {
      page,
      limit,
      search: filters.search?.trim() || undefined,
      status: filters.status || undefined,
      opportunityView: filters.view && filters.view !== 'leads' ? filters.view : undefined,
    },
    requires: ['leads.view'],
  });
  return toPage(response.leads, response.pagination, page);
}

export function fetchLead(id: number): Promise<LeadDetail> {
  return api.get<LeadDetail>(`/api/leads/${id}`, { requires: ['leads.view'] });
}

export function fetchLeadActivity(id: number): Promise<LeadActivity> {
  return api.get<LeadActivity>(`/api/leads/${id}/activity`, { requires: ['leads.view'] });
}

export async function fetchLeadStatuses(): Promise<LeadStatusOption[]> {
  const response = await api.get<{ data: LeadStatusOption[] }>('/api/lead-statuses');
  return response.data ?? [];
}

export interface CreateLeadInput {
  fname: string;
  lname: string;
  email: string;
  phone: string;
  priority?: string;
  notes?: string;
}

export interface CreatedLead extends Partial<LeadListItem> {
  id: number;
  possibleDuplicates?: unknown[];
}

/**
 * Creates a lead in the user's own branch. A counselor can only ever create leads for
 * themselves (the server enforces it); managers who omit the owner get it by default.
 */
export function createLead(input: CreateLeadInput, user: SessionUser): Promise<CreatedLead> {
  return api.post<CreatedLead>(
    '/api/leads',
    {
      fname: input.fname.trim(),
      lname: input.lname.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      priority: input.priority,
      lead_remark: input.notes?.trim() || undefined,
      branch: user.branch,
      assignTo: user.id,
    },
    { requires: ['leads.create'] },
  );
}

export function updateLead(id: number, patch: Partial<Pick<CreateLeadInput, 'fname' | 'lname' | 'email' | 'phone' | 'priority'>>): Promise<unknown> {
  return api.put(`/api/leads/${id}`, patch, { requires: ['leads.update', 'leads.create'] });
}

/**
 * Status change with the reason the web app also requires. `PUT /api/leads/[id]` writes the
 * activity-log entry ("Status changed from X to Y: note"); client statuses are refused by
 * the server until finance and compliance have both approved.
 */
export function changeLeadStatus(id: number, status: string, notes: string): Promise<unknown> {
  return api.put(`/api/leads/${id}`, { status, notes }, { requires: ['leads.update', 'leads.create'] });
}

export function addRemark(leadId: number, remark: string, employeeId: number): Promise<unknown> {
  // employeeId is trusted from the body and defaults to 1 server-side, so it must be sent.
  return api.post('/api/lead-remarks', { leadId, remark: remark.trim(), employeeId }, { requires: ['leads.update'] });
}

// ---------- follow-ups & appointments ----------------------------------

export type FollowUpFilter = 'overdue' | 'upcoming' | 'completed';

export async function fetchFollowUps(filter: FollowUpFilter, page = 1, limit = 30): Promise<Page<FollowUp>> {
  const response = await api.get<{ reminders: FollowUp[]; pagination?: RawPagination }>('/api/follow-up-reminders', {
    query: { status: filter, page, limit },
  });
  return toPage(response.reminders, response.pagination, page);
}

export interface CreateFollowUpInput {
  leadId: number;
  employeeId: number;
  /** ISO date-time. */
  scheduledAt: string;
  message: string;
  priority?: 'low' | 'medium' | 'high';
}

export function createFollowUp(input: CreateFollowUpInput): Promise<unknown> {
  return api.post('/api/follow-up-reminders', {
    leadId: input.leadId,
    employeeId: input.employeeId,
    scheduledAt: input.scheduledAt,
    message: input.message.trim(),
    priority: input.priority ?? 'medium',
  });
}

export function actOnFollowUp(reminderId: number, action: 'complete' | 'cancel', notes?: string): Promise<unknown> {
  return api.put('/api/follow-up-reminders', { reminderId, action, notes: notes?.trim() || undefined });
}

export type AppointmentFilter = 'upcoming' | 'today' | 'done';

export async function fetchAppointments(filter: AppointmentFilter, page = 1, limit = 50): Promise<Page<Appointment>> {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const response = await api.get<{ appointments: Appointment[]; pagination?: RawPagination }>('/api/appointments', {
    query: {
      page,
      limit,
      date: filter === 'today' ? iso : undefined,
      // 'booked' = scheduled and not yet done; 'completed' = done (see getAppointmentStatusCondition).
      status: filter === 'done' ? 'completed' : filter === 'upcoming' ? 'booked' : undefined,
    },
  });
  // The endpoint sorts newest first; "upcoming" keeps the scheduled ones from today on, soonest first.
  const items =
    filter === 'upcoming' ? response.appointments.filter((a) => (a.date ?? '') >= iso).reverse() : response.appointments;
  return { ...toPage(items, response.pagination, page) };
}

// ---------- lead pool ---------------------------------------------------

export interface LeadPoolResponse {
  leads: PoolLead[];
  total: number;
  canClaim: boolean;
  slaMinutes?: number;
  pagination?: RawPagination;
}

export function fetchLeadPool(page = 1, search?: string, limit = 30): Promise<LeadPoolResponse> {
  return api.get<LeadPoolResponse>('/api/admin/lead-pool', {
    query: { page, limit, search: search?.trim() || undefined, assigned: 'unassigned' },
    requires: ['leads.view'],
  });
}

export function claimLead(leadId: number): Promise<{ success: boolean; leadName?: string }> {
  return api.post('/api/admin/lead-pool/claim', { leadId }, { requires: ['leads.update'] });
}
