import { describe, expect, it } from 'vitest';
import { generateMfaPendingToken, generateToken, verifyMfaPendingToken, verifyToken, type User } from '../../src/lib/auth';

const user: User = {
  id: 7,
  name: 'Test User',
  email: 'test@example.com',
  cemail: 'test@example.com',
  role: 2,
  branch: 1,
  region: 1,
  type: 'staff',
  roleName: 'Counselor',
  wfh: 0,
  permissions: ['leads.view'],
};

describe('verifyToken / generateMfaPendingToken purpose isolation', () => {
  it('verifies a real session token and returns the user payload', () => {
    const token = generateToken(user);
    expect(verifyToken(token)?.id).toBe(7);
  });

  it('never accepts an MFA-pending token as a full session - the whole point of the second factor', () => {
    // Regression test: verifyToken() used to ignore the `purpose` claim, so a
    // token minted for "password verified, MFA not yet verified" authenticated
    // as a full session on any route that didn't itself re-check `purpose`
    // (e.g. POST/DELETE /api/mobile/devices, GET/PUT /api/notifications) -
    // a full MFA bypass reachable with just a stolen password.
    const mfaPendingToken = generateMfaPendingToken(7);
    expect(verifyToken(mfaPendingToken)).toBeNull();
  });

  it('still lets the dedicated MFA-verify step read the pending token', () => {
    const mfaPendingToken = generateMfaPendingToken(7);
    expect(verifyMfaPendingToken(mfaPendingToken)).toBe(7);
  });
});
