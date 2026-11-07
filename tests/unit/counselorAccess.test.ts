import { describe, expect, it } from 'vitest';
import { canAccessAdminPath } from '@/lib/roleAccess';

// Aaron Paul's role (Senior Immigration Advisor) with its real permission set.
const counselor = {
  role: 37,
  roleName: 'Senior Immigration Advisor',
  type: 'senior_immigration_advisor',
  permissions: ['sales.view', 'sales.create', 'sales.update', 'operations.view', 'reports.view', 'leads.view', 'leads.create', 'leads.update',
    'appointments.view', 'appointments.manage', 'documents.view', 'documents.create', 'documents.update', 'agreements.view', 'agreements.create',
    'clients.view', 'clients.create', 'clients.update', 'fees.view', 'it.create', 'it.self'],
};
const director = { role: 5, roleName: 'Director of Sales', type: 'director_of_sales', permissions: ['leads.view', 'operations.view', 'reports.view'] };

describe('counselor page access', () => {
  it.each([
    '/admin/leads', '/admin/follow-ups', '/admin/appointments', '/admin/reports/lead-status', '/admin/reports/panel', '/admin/ops-my-assignments', '/admin/it-support/my-tickets',
  ])('can open %s', (path) => expect(canAccessAdminPath(counselor, path)).toBe(true));

  it.each([
    '/admin/lead-assignment-availability', '/admin/leads/assignment-rules', '/admin/lead-pool', '/admin/finance', '/admin/employees', '/admin/roles',
    '/admin/ops-dashboard', '/admin/operations-management', '/admin/ops-report', '/admin/ops-clients/visit-visa', '/admin/ops-assign', '/admin/it-support',
  ])('cannot open %s', (path) => expect(canAccessAdminPath(counselor, path)).toBe(false));
});

describe('director of sales page access', () => {
  it.each(['/admin/lead-assignment-availability', '/admin/leads/assignment-rules'])('can open %s', (path) => expect(canAccessAdminPath(director, path)).toBe(true));
});
