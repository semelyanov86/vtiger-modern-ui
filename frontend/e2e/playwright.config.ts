/**
 * Browser scenarios of ModernUI. MU_E2E_TARGET picks the instance (env.ts): `dev` — the dev instance of .env,
 * `c81`/`c85` — the clean Vtiger 8.4.0 stand (task clean:*). Projects:
 *
 * - install  — the web installer of a clean instance (task clean:install);
 * - auth     — signs the administrator in once (dependency of the others);
 * - modernui — the module on a registered instance: settings, enable for me, loader, shell, languages, safe mode,
 *              failures, standard view (task test:e2e, task test:e2e:clean);
 * - clean    — clean stand only: pilot for a restricted user, other users untouched, Module Manager switch,
 *              custom entity module, English fallback (task test:e2e:clean);
 * - baseline — behaviour of the CRM without the theme: pages, errors, timings (task baseline);
 * - import   — Settings → Module Manager → Import of MU_IMPORT_ZIP (task clean:import-zip, PACKAGE run);
 * - devcycle — edit → result on the dev instance for PHP, Smarty, Vue/CSS and translations (task test:devcycle);
 * - devrecord — a synthetic record through the standard form with the theme on, then its deletion (task test:devrecord).
 *
 * The tests change the theme settings of the signed-in users, so they run one after another. No screenshots,
 * traces or videos: pages of a dev instance may show customer data.
 */
import { defineConfig } from '@playwright/test'
import { crmUrl, repoRoot, stateFile, target } from './env'

const admin = stateFile('admin')

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: `${repoRoot}/.local/e2e-output/${target}`,
  use: {
    baseURL: crmUrl(),
    viewport: { width: 1440, height: 900 },
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'install', testMatch: /tools\/install\.spec\.ts$/ },
    { name: 'auth', testMatch: /auth\.setup\.ts$/ },
    { name: 'modernui', testMatch: /modernui\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'clean', testMatch: /clean\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'baseline', testMatch: /baseline\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'import', testMatch: /tools\/module-import\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'devcycle', testMatch: /devcycle\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'devrecord', testMatch: /devrecord\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
  ],
})
