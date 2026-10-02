import { defineConfig, devices } from '@playwright/test';
import { MOCK_SUPABASE_ANON_KEY, MOCK_SUPABASE_URL } from './tests/support/mock-backend';

// Run with:  npx playwright test
// (the first time on a new computer, also run:  npx playwright install chromium)
const PORT = 5199;

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Requests from a service worker bypass Playwright's mocks, so keep it out.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Point the app at a fake Supabase address (the tests answer for it), so a
    // developer's real .env keys can never be used by the tests.
    env: { VITE_SUPABASE_URL: MOCK_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: MOCK_SUPABASE_ANON_KEY },
  },
});
