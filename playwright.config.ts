import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

// Baseline e2e suite (docs/ENTERPRISE_READINESS_ROADMAP.md Phase 2 item 3).
// Runs against E2E_BASE_URL (default http://localhost:3000) using the
// dedicated test account from scripts/seed-e2e-test-user.js - never a real
// employee. Points at whatever DATABASE_URL the dev server it's testing is
// already running against; this project has no separate test database, so
// tests are written to create their own clearly-labeled records rather than
// touching existing ones (see tests/e2e/fixtures.ts).
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // shared login state + shared DB - avoid concurrent mutation races between tests
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  // Generous: `next dev` (Turbopack) compiles each route on first hit - both
  // on the server (API routes) and client-side (page bundles compile on
  // first navigation too), and this suite runs against dev, not a production
  // build. A single test can cross several never-before-hit routes, each
  // adding 10-20s the first time only - a production build has none of this.
  timeout: 90 * 1000,
  expect: { timeout: 20 * 1000 },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20 * 1000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
