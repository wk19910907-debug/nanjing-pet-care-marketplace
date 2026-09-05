import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: ['production-web-access.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  outputDir: process.env.PILOT_ACCEPTANCE_OUTPUT_DIR,
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    channel: 'chrome',
    viewport: { width: 390, height: 844 },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
