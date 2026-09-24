import type { SessionUser } from '@/features/auth/types';

// Users shaped like the real seeded roles (scripts/seed-roles-permissions.js in the web repo).
const base = { email: 'x@example.com', cemail: 'x@example.com', role: 2, branch: 1, region: 1, wfh: 0, mustChangePassword: false };

export const ceo: SessionUser = { ...base, id: 1, name: 'Roopa', type: 'director', roleName: 'CEO', permissions: ['all', 'admin.access', 'leads.view'] };

/** Director type but NOT the CEO role - the case a `type === 'director'` check gets wrong. */
export const otherDirector: SessionUser = { ...base, id: 2, name: 'Dir', type: 'director', roleName: 'Director', permissions: ['leads.view', 'reports.view'] };

export const teamLeader: SessionUser = {
  ...base,
  id: 3,
  name: 'Mehak',
  type: 'team_leader',
  roleName: 'Team Leader',
  permissions: ['leads.view', 'leads.update', 'clients.view', 'transfers.manage'],
};

export const counselor: SessionUser = {
  ...base,
  id: 4,
  name: 'Harpreet',
  type: 'immigration_advisor',
  roleName: 'Immigration Advisor',
  permissions: ['leads.view', 'leads.update', 'leads.create', 'clients.view', 'appointments.view', 'it.self', 'hr.self'],
};

export const accounts: SessionUser = {
  ...base,
  id: 5,
  name: 'Accounts',
  type: 'accounts',
  roleName: 'Accounts',
  permissions: ['finance.view', 'finance.manage', 'payments.view', 'it.self'],
};

export const hr: SessionUser = { ...base, id: 6, name: 'HR', type: 'hr', roleName: 'HR', permissions: ['hr.view', 'hr.self', 'it.self'] };
