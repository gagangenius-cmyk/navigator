import type { User } from '@/lib/auth';

/**
 * hr.self is every employee's self-service grant. Routes that accept both an
 * HR-wide permission and hr.self must pin a self-service-only caller to their
 * own employee id - otherwise anyone logged in can pass someone else's
 * employee_id and read (or file for) a colleague. Mirrors the boundary
 * /api/admin/hr/payslips already enforces.
 */
export function hasAnyHrPermission(user: User, perms: string[]): boolean {
  return Boolean(user.permissions?.includes('all') || perms.some((p) => user.permissions?.includes(p)));
}

export function isOwnEmployeeId(user: User, employeeId: string | number | null | undefined): boolean {
  return employeeId !== null && employeeId !== undefined && String(employeeId) === String(user.id);
}
