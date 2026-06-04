import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, webServerEnv } from './tests/e2e/e2e-env';

// E2E suite for the OSS auth + quiz lifecycle (MID-81). Complements the
// Socket.IO realtime smoke (scripts/smoke.ts) with browser-level coverage of
// signup → signin → reset and the authenticated quiz/game/upload flows.
//
// One Postgres DB (primetime_e2e) is shared by the whole run, so tests run
// serially (workers: 1) and reset their tables in beforeEach — no parallelism
// to avoid cross-test interference.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Create + migrate the E2E DB, then boot the custom Next/Socket.IO server.
    // webServerEnv pins DATABASE_URL to the E2E DB and the OSS config profile;
    // shell env wins over .env.local under @next/env, so this overrides a
    // developer's local config reliably.
    command: 'npm run db:e2e:reset && npm run dev',
    url: `${E2E_BASE_URL}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: webServerEnv,
  },
});
