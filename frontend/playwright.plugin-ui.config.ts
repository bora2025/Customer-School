import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
const port = process.env.PLAYWRIGHT_WEB_PORT || '4141';
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './e2e/plugin-ui',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    [path.resolve(__dirname, 'scripts', 'plugin-ui-result-reporter.js')],
  ],
  webServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === 'true' ? undefined : {
    command: `node node_modules/next/dist/bin/next dev --webpack --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
});
