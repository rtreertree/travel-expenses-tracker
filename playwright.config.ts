import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        timezoneId: 'Asia/Bangkok',
      },
    },
  ],
  webServer: {
    command: 'npx tsx scripts/test-server.ts',
    url: 'http://127.0.0.1:4174/api/v1/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
