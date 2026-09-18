import { defineConfig } from 'vitest/config';
import path from 'path';

// Unit tests for pure logic (tests/unit) - separate from the Playwright
// e2e suite (tests/e2e, its own playwright.config.ts, needs a running
// dev server + the shared DB). Vitest here never touches the DB or network.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
});
