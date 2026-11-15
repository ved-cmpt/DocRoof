import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack (API on 5180 + Angular dev server on 4210, or the production
 * container). Set E2E_BASE_URL to target another origin, e.g. the production image on http://localhost:5180.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4210',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /(screenshots|og-image|review)\.spec\.ts/,
    },
    {
      name: 'screenshots',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(screenshots|og-image)\.spec\.ts/,
    },
    {
      // Design review capture into ../.local/review (not committed).
      name: 'review',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /review\.spec\.ts/,
    },
  ],
});
