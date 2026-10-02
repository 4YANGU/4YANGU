import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests for the store-owner dashboard.
 *
 *   npx playwright install chromium   (once per machine)
 *   npm run test:e2e
 *
 * The tests start the Vite dev server themselves (port 5199) with a made-up Supabase project and
 * answer every /api/** call with canned data (see e2e/support/ownerApp.ts), so they need no real
 * account, database or internet connection.
 *
 * To test an app that is already running instead, set PLAYWRIGHT_BASE_URL, for example
 *   PLAYWRIGHT_BASE_URL=http://localhost:4173 npm run test:e2e
 * (that copy must have been built with VITE_SUPABASE_URL=https://e2e.supabase.test).
 */
const PORT = 5199;
const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          VITE_SUPABASE_URL: 'https://e2e.supabase.test',
          VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
        },
      },
});
