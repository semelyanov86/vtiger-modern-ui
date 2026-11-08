/**
 * Browser scenarios of ModernUI. MU_E2E_TARGET picks the instance (env.ts): `dev` — the dev instance of .env,
 * `c81`/`c85` — the clean Vtiger 8.4.0 stand (task clean:*). Projects:
 *
 * - install  — the web installer of a clean instance (task clean:install);
 * - auth     — signs the administrator in once (dependency of the others);
 * - modernui — the module on a registered instance: settings, enable for me, loader, shell, languages, safe mode,
 *              failures, standard view (task test:e2e, task test:e2e:clean);
 * - clean    — clean stand only: pilot for a restricted user, other users untouched, Module Manager switch,
 *              custom entity module, English fallback; settings of users with different permissions — menu by
 *              permissions, role profiles, personal keys, role change, refused administrator actions (access.spec.ts);
 * - settings — the settings editor and the preferences editor as an administrator (stage 05, both stands);
 * - navigation — the navigation shell (mega menu, favorites bar, module rail) and the list screens (stage 06, both stands);
 * - records  — record views, forms, line items, saving, errors and rights compared with v7 (stage 07, both stands; writes
 *              synthetic records MU07 and deletes them);
 * - special  — adapters of extensions, pages outside the CRM interface, printing, export, rich text editors, dashboard and
 *              calendar drag and drop (stage 08, both stands; synthetic events MU08 on the clean stand);
 * - cloud-settings — the system settings in the cloud layout of the settings (stage 15, both stands): catalog, search,
 *              navigation, inner pages, dialogs, languages, widths and recovery against v7; on the clean stand a restricted
 *              user and real changes (role, user, field, picklist value, workflow MU15, deleted again);
 * - foundation — the visual foundation (stage 10): tokens of the server = preview, the cloud font and the pinned Cyrillic
 *              face, the states of buttons, fields, Select2, check boxes, rows, menus, tabs, dialogs, notifications, the
 *              settings editor, densities and 200 % against the measured cloud reference (both stands, read-only for the CRM);
 * - screens  — every screen of the instance (special screens, Settings, lists and records of all modules) with and
 *              without the theme: lost or covered actions, new errors, scrolling, level of the theme (stage 08, read-only);
 * - baseline — behaviour of the CRM without the theme: pages, errors, timings (task baseline);
 * - import   — Settings → Module Manager → Import of MU_IMPORT_ZIP (task clean:import-zip, PACKAGE run);
 * - devcycle — edit → result on the dev instance for PHP, Smarty, Vue/CSS and translations (task test:devcycle);
 * - devrecord — a synthetic record through the standard form with the theme on, then its deletion (task test:devrecord);
 * - visual   — screenshots of the main screens with and without the theme for the visual review (task shots); the
 *              only project that writes images, into MU_SHOTS_DIR (private directory on the dev instance);
 * - measure  — cost of the theme against the same CRM in safe mode: timings, layout shift, bytes, Bootstrap (task measure).
 *
 * The tests change the theme settings of the signed-in users, so they run one after another. No screenshots,
 * traces or videos (except the visual project): pages of a dev instance may show customer data.
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
    { name: 'clean', testMatch: /(?:clean|access|extensions)\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'settings', testMatch: /(?:^|[\\/])settings\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'navigation', testMatch: /navigation\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'records', testMatch: /records\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'special', testMatch: /special\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'screens', testMatch: /screens\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'layout', testMatch: /layout\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'cloud-records', testMatch: /cloud-records\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'cloud-forms', testMatch: /cloud-forms\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'cloud-settings', testMatch: /cloud-settings\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'foundation', testMatch: /foundation\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'lists', testMatch: /lists\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'pairs', testMatch: /pairs\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'baseline', testMatch: /baseline\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'import', testMatch: /tools\/module-import\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'devcycle', testMatch: /devcycle\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'devrecord', testMatch: /devrecord\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'visual', testMatch: /visual\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
    { name: 'measure', testMatch: /measure\.spec\.ts$/, dependencies: ['auth'], use: { storageState: admin } },
  ],
})
