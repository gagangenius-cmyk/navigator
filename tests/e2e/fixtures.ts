import { Page, expect } from '@playwright/test';

// Shared across every e2e spec - logs in as the dedicated test account from
// scripts/seed-e2e-test-user.js (never a real employee). Every test that
// needs an authenticated session should call this first thing.
export async function loginAsTestUser(page: Page): Promise<void> {
  const username = process.env.E2E_TEST_USERNAME;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!username || !password) {
    throw new Error(
      'E2E_TEST_USERNAME / E2E_TEST_PASSWORD are not set. Run `npm run db:seed:e2e-test-user` and add the printed values to .env.'
    );
  }

  await page.goto('/login');
  await page.getByLabel('Login ID').fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Successful login replaces the URL away from /login - wait for that
  // rather than a specific destination path, since the default landing page
  // depends on role and isn't this test's concern. Generous timeout: next
  // dev (Turbopack) compiles each API route on first hit, and /api/auth/login
  // being the very first request of a cold dev server can itself take
  // 10-20s+ to compile - not present in a production build.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45000 });
}

// Every record an e2e test creates gets this prefix in its name/email so it
// is unambiguously identifiable as test data in the shared dev database
// (this project has no separate test DB - see playwright.config.ts) and can
// be found/cleaned up later with a single search. Letters-only deliberately -
// name fields are validated against /^[\p{L}][\p{L}\s.'-]*$/u (no digits),
// which "E2E" itself would fail (the digit "2").
export const E2E_TAG = 'AutomatedTest';

export function uniqueTestEmail(label: string): string {
  return `e2e-${label}-${Date.now()}@example.invalid`;
}

// Duplicate-lead detection (src/lib/duplicateLeadCheck.ts) matches on phone
// as well as email, so re-running this suite with a fixed phone number gets
// correctly blocked as a duplicate of the previous run's lead - a real
// feature working as intended, not a bug. 10 digits, within the accepted
// 7-15 range, last 9 digits of Date.now() prefixed with a non-zero digit.
export function uniqueTestPhone(): string {
  return `5${Date.now().toString().slice(-9)}`;
}
