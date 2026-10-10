import { defineConfig, devices } from '@playwright/test';

// Acceptance browser journeys for the Settings Playground (issue #22).
//
// Seam: `bun run serve:e2e` (a script in web/playground/package.json) builds the playground
// together with the settings WASM package and serves it at http://127.0.0.1:4317/. Set
// PLAYGROUND_URL to run against an already running server instead.
const externalUrl = process.env.PLAYGROUND_URL;
const baseURL = externalUrl ?? 'http://127.0.0.1:4317/';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: externalUrl
    ? undefined
    : {
        command: 'bun run serve:e2e',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 300_000,
      },
});
