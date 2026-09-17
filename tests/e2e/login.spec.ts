import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './fixtures';

// Foundational - every other e2e spec depends on this working, and
// src/proxy.ts (the auth gate added in Phase 1) + src/lib/auth.ts are both
// on the critical path for literally every authenticated screen in the app.
test.describe('Login', () => {
  test('logs in with valid credentials and lands on an authenticated admin page', async ({ page }) => {
    await loginAsTestUser(page);

    // Sidebar nav only renders for an authenticated session (src/components/layout/DashboardLayout.tsx).
    await expect(page.getByRole('link', { name: 'Leads', exact: true }).first()).toBeVisible();
  });

  test('rejects an invalid password and stays on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Login ID').fill(process.env.E2E_TEST_USERNAME || 'e2e_test_bot');
    await page.getByLabel('Password', { exact: true }).fill('definitely-the-wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated request to an admin page is redirected to login', async ({ page }) => {
    // Exercises src/proxy.ts directly (Phase 1's central auth gate) rather
    // than relying on the client-side redirect alone.
    await page.goto('/admin/leads');
    await expect(page).toHaveURL(/\/login/);
  });
});
