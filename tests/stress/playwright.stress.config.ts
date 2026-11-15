import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './scenarios',
  timeout: 30 * 1000,
  expect: {
    timeout: 7000,
  },
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1, // Sequential execution to accurately simulate real browser load & stress
  reporter: [
    ['list'],
    ['json', { outputFile: 'tests/stress/results.json' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
