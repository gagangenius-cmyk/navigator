/** A row of GET /api/leads (only the fields the app uses). */
export interface LeadListItem {
  id: number;
  fname: string | null;
  lname: string | null;
  client_actual_name?: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  whatsapp_number: string | null;
  status: string | null;
  priority: string | null;
  lead_quality: string | null;
  regdate?: string | null;
  created: string | null;
  payTotal: number | string | null;
  paidYet: number | string | null;
  payBalance: number | string | null;
  latest_remark: string | null;
  assignTo: number | null;
  assigned_to_name: string | null;
  branch: number | null;
  branch_name: string | null;
  country_interest_label: string | null;
  service_interest_label: string | null;
  market_source_label: string | null;
  lead_score?: number | null;
  lead_score_label?: string | null;
  opp_status?: string | null;
  opp_stage?: string | null;
  discount_status?: string | null;
  finance_status?: string | null;
  compliance_status?: string | null;
}

/** GET /api/leads/[id]: the lead row (l.*) plus joined labels. */
export interface LeadDetail extends Omit<LeadListItem, 'discount_status'> {
  // Raw ids behind service_interest_label/country_interest_label - the labels are for
  // display, these are what the edit form needs to preselect the right chip.
  service_interest: string | number | null;
  country_interest: string | number | null;
  mname: string | null;
  nationality: string | null;
  address: string | null;
  dob: string | null;
  gender: string | null;
  Counsilor: number | null;
  counselor_name: string | null;
  lead_remark: string | null;
  followup: string | null;
  folowuptime: string | null;
  discount: number | string | null;
  agreement_number: string | null;
  campaign?: string | null;
  // crm_forum_leads' own legacy flag column - NOT the discount approval's status
  // (that's discount_approval_status below). Included only because l.* pulls it in.
  discount_status?: number | null;

  // Opportunity/workflow summary - same fields the lead list already carries, added
  // to the single-lead query so the detail screen doesn't need a second round trip
  // to /api/crm-workflow/{opportunityId} just to show "what stage is this at".
  resolved_opportunity_id: number | null;
  opp_status: string | null;
  opp_stage: string | null;
  paymentReceived: number | boolean | null;
  agreementGenerated: number | boolean | null;
  agreementSigned: number | boolean | null;
  retentionStatus: string | null;
  paymentStatus: string | null;
  discount_approval_status: string | null;
  workflow_status: string | null;
  finance_status: string | null;
  compliance_status: string | null;
  finance_reason: string | null;
  compliance_reason: string | null;
}

/** A row of GET /api/services or GET /api/countries. */
export interface LookupOption {
  id: number;
  name: string;
}

export interface LeadStatusOption {
  id: number;
  name: string;
  badge_class: string | null;
  kanban_accent_class: string | null;
  uses_p_priority_scale: number | boolean | null;
  sort_order: number;
}

export interface LeadRemark {
  id: number;
  lead: number;
  date: string | null;
  created: string | null;
  remark: string | null;
  emp: number | null;
  employeeName: string | null;
}

export interface LeadActivityEntry {
  id: number;
  lead_id: number;
  action: string;
  remark: string | null;
  previous_value: string | null;
  new_value: string | null;
  actor_id: number | null;
  actor_role: string | null;
  created_at: string;
  actorName: string | null;
}

export interface FollowUp {
  id: number;
  lead_id: number;
  user_id: number;
  reminder_date: string;
  message: string | null;
  status: string;
  priority: string | null;
  completed_at?: string | null;
  employeeName?: string | null;
  fname?: string | null;
  lname?: string | null;
  phone?: string | null;
  email?: string | null;
  leadStatus?: string | null;
}

export interface Appointment {
  id: number;
  leadid: number;
  date: string | null;
  appointtime: string | null;
  counsilorid: number | null;
  booked: number | null;
  done: number | null;
  not_done: number | null;
  remarks?: string | null;
  meeting_status?: string | null;
  fname?: string | null;
  lname?: string | null;
  leadPhone?: string | null;
  leadMobile?: string | null;
  counselorName?: string | null;
  branchName?: string | null;
}

export interface LeadActivity {
  appointments: Appointment[];
  followUps: FollowUp[];
  remarks: LeadRemark[];
  activityLog: LeadActivityEntry[];
  activityLogTotal: number;
}

export interface PoolLead {
  id: number;
  fname: string;
  lname: string;
  email: string;
  phone: string;
  status: string;
  priority: string;
  nationality: string;
  serviceInterest: string;
  marketSource: string;
  branch: number | null;
  branchName: string;
  assignTo: number | null;
  assigneeName: string;
  created: string;
  poolEnteredAt: string | null;
  poolMinutesWaiting: number | null;
}

export type LeadView = 'leads' | 'my-leads' | 'clients' | 'my-clients';

export interface LeadFilters {
  search?: string;
  status?: string;
  view?: LeadView;
}

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

/** Display name of a lead, preferring the client's actual name once converted. */
export function leadName(lead: Pick<LeadListItem, 'fname' | 'lname' | 'client_actual_name'>): string {
  const actual = lead.client_actual_name?.trim();
  if (actual) return actual;
  return `${lead.fname ?? ''} ${lead.lname ?? ''}`.trim() || 'Unnamed lead';
}

export const leadPhone = (lead: Pick<LeadListItem, 'mobile' | 'phone' | 'whatsapp_number'>): string | null =>
  lead.mobile?.trim() || lead.phone?.trim() || lead.whatsapp_number?.trim() || null;
