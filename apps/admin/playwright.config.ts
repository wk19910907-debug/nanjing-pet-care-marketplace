import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', use: { baseURL: 'http://127.0.0.1:41739', channel: 'chrome' },
  webServer: { command: 'pnpm dev --port 41739', url: 'http://127.0.0.1:41739', reuseExistingServer: false },
});
