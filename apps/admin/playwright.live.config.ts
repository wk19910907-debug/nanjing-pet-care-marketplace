import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['pilot-live.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: process.env.PILOT_ACCEPTANCE_OUTPUT_DIR,
  use: {
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
