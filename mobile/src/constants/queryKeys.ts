// Central registry of TanStack Query keys, so invalidation (push received,
// mutation succeeded, sign-out) and the queries themselves can never drift apart.
export const queryKeys = {
  dashboard: (range?: string) => ['dashboard', range ?? 'month'] as const,

  leads: ['leads'] as const,
  leadList: (filters: unknown) => ['leads', 'list', filters] as const,
  leadDetail: (id: number) => ['leads', 'detail', id] as const,
  leadActivity: (id: number) => ['leads', 'activity', id] as const,
  leadStatuses: ['lead-statuses'] as const,
  leadFilterOptions: ['lead-filter-options'] as const,
  leadPool: ['lead-pool'] as const,
  clients: ['clients'] as const,
  employees: ['employees'] as const,

  approvals: ['approvals'] as const,
  discounts: (status: string) => ['approvals', 'discounts', status] as const,
  compliance: (status: string) => ['approvals', 'compliance', status] as const,
  payments: (status: string) => ['approvals', 'payments', status] as const,
  approvalSummary: ['approvals', 'summary'] as const,
  balances: ['balances'] as const,

  notifications: ['notifications'] as const,
  followUps: (filter: string) => ['follow-ups', filter] as const,
  appointments: (filter: string) => ['appointments', filter] as const,

  attendance: ['hr', 'attendance'] as const,
  leave: ['hr', 'leave'] as const,
  payslips: ['hr', 'payslips'] as const,
  itTickets: ['it-tickets'] as const,
  profile: ['profile'] as const,
} as const;
