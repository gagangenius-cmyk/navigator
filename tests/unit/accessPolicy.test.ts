import { describe, expect, it } from 'vitest';
import { canAdministerAccess, canGrantPermissions, PERMISSION_KEY_PATTERN } from '@/lib/accessPolicy';

describe('canAdministerAccess', () => {
  it('allows the CEO by role name even without the all permission', () => {
    expect(canAdministerAccess({ roleName: 'CEO', permissions: ['roles.manage'] })).toBe(true);
  });
  it('allows full admins carrying the all permission', () => {
    expect(canAdministerAccess({ roleName: 'Director', permissions: ['all'] })).toBe(true);
  });
  it('denies roles.manage / admin.access holders who are not CEO or full admin', () => {
    expect(canAdministerAccess({ roleName: 'HR Manager', permissions: ['roles.manage', 'admin.access'] })).toBe(false);
    expect(canAdministerAccess(null)).toBe(false);
  });
});

describe('PERMISSION_KEY_PATTERN', () => {
  it.each(['visa.approve', 'hr.team.attendance_leave', 'it.approve.manager'])('accepts %s', (key) => {
    expect(PERMISSION_KEY_PATTERN.test(key)).toBe(true);
  });
  it.each(['all', '*', 'Visa.Approve', 'visa.', '.approve', 'visa approve', '1visa.x', 'a..b'])('rejects %s', (key) => {
    expect(PERMISSION_KEY_PATTERN.test(key)).toBe(false);
  });
});

describe('canGrantPermissions', () => {
  const hr = { roleName: 'HR Manager', permissions: ['hr.view', 'hr.update', 'employees.manage'] };

  it('lets a non-admin assign a role within their own permissions', () => {
    expect(canGrantPermissions(hr, ['hr.view'])).toEqual({ ok: true });
  });
  it('blocks assigning a role holding permissions the caller lacks', () => {
    expect(canGrantPermissions(hr, ['hr.view', 'finance.manage']).ok).toBe(false);
  });
  it('blocks assigning an administrator (all) role', () => {
    expect(canGrantPermissions(hr, ['all']).ok).toBe(false);
  });
  it('lets the CEO assign anything', () => {
    expect(canGrantPermissions({ roleName: 'CEO', permissions: [] }, ['all', 'finance.manage'])).toEqual({ ok: true });
  });
});
