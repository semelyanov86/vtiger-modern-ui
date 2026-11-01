/**
 * Browser checks of ModernUI on a Vtiger instance (task test:e2e). The tests change the theme settings of the
 * signed-in administrator, so they run one after another; they leave the theme switched on for that
 * administrator only. No screenshots or traces are written: pages of a dev instance may show customer data.
 */
import { defineConfig } from '@playwright/test'
import { crmUrl, repoRoot, stateFile } from './env'

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: `${repoRoot}/.local/e2e-output`,
  globalSetup: './global-setup.ts',
  use: {
    baseURL: crmUrl(),
    storageState: stateFile,
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
})
