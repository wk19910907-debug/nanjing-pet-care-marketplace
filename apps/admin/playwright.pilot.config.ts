import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['pilot-auth-ui.spec.ts', 'pilot-owner-ui.spec.ts'],
  use: {
    baseURL: 'http://127.0.0.1:41740',
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'pnpm dev --mode pilot --port 41740 --strictPort',
    url: 'http://127.0.0.1:41740',
    reuseExistingServer: false,
  },
});
