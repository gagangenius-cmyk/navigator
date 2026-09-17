import { test, expect } from '@playwright/test';
import { loginAsTestUser, E2E_TAG, uniqueTestEmail, uniqueTestPhone } from './fixtures';

// src/app/api/leads/route.ts and src/components/leads/LeadManagement.tsx are
// the two files that recur most often across this repo's "bug fixed" commit
// history (see docs/ENTERPRISE_READINESS_ROADMAP.md Phase 2 item 3) - this
// covers the entry point of that pipeline: creating a lead through the real
// UI and confirming it round-trips through the API and database into the
// Lead List.
test.describe('Lead creation', () => {
  test('creating a lead through the UI makes it appear in the Lead List', async ({ page }) => {
    await loginAsTestUser(page);

    // Last name must be letters-only (both the API's and the form's own
    // validation reject digits: /^[\p{L}][\p{L}\s.'-]*$/u) - uniqueness for
    // this test comes from the email instead, which has no such restriction.
    const lastName = `${E2E_TAG}Lead`;
    const email = uniqueTestEmail('lead');
    const phone = uniqueTestPhone();

    await page.goto('/admin/leads');
    await page.getByRole('button', { name: /add new lead/i }).click();
    await expect(page).toHaveURL(/\/admin\/leads\/create/);

    await page.locator('input[name="firstName"]').fill('Playwright');
    await page.locator('input[name="lastName"]').fill(lastName);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="phone"]').fill(phone);

    await page.getByRole('button', { name: /^save$/i }).click();

    // Successful creation shows a toast and navigates away from the create form.
    // No explicit timeout override here - inherits playwright.config.ts's global
    // expect timeout (20s), generous enough for next dev's on-demand compiles.
    await expect(page).not.toHaveURL(/\/admin\/leads\/create/);

    // Confirm it actually persisted, not just that the form navigated away -
    // search the Lead List for the unique email this test generated and
    // confirm exactly one record matches, via the "Records" counter rather
    // than the row's own name text: LeadManagement.tsx renders both a desktop
    // table row and a CSS-hidden (on desktop viewport) mobile card for the
    // same lead, so a plain getByText().first() flakily resolves to whichever
    // of the two happens to come first in DOM order, hidden or not.
    await page.goto('/admin/leads');
    const search = page.getByPlaceholder(/search leads by name, phone, email/i);
    await search.fill(email);
    // The list debounces search input (LeadManagement.tsx) before refetching.
    await expect(page.getByText('Records').locator('xpath=following-sibling::span[1]')).toHaveText('1');
  });
});
