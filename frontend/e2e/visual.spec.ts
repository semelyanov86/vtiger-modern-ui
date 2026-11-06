/**
 * Screenshots of the main screens for the visual review of the skin (stage 04, docs/design.md §6, §8):
 * every screen at 1440/1024/768/412 px, with the theme and in safe mode (the same CRM without ModernUI), plus
 * open overlays (quick create, Select2, date picker, validation message, notification, dropdown).
 *
 * The images go to MU_SHOTS_DIR. Pages of a dev instance may show customer data, so for the dev target the
 * directory must be given explicitly (the private data directory of PRIVATE.md); for the clean stand it
 * defaults to .local/shots/<target>/. Nothing is written into the repository.
 *
 * MU_SHOTS_WIDTHS (default "1440,1024,768,412"), MU_SHOTS_SCREENS (comma separated ids) and
 * MU_SHOTS_MODES ("theme,standard") narrow a run; MU_SHOTS_ZOOM=2 emulates 200 % browser zoom
 * (deviceScaleFactor 2 at half the CSS width).
 *
 * MU_SHOTS_LOCAL_BUILD=1 (review of a work in progress on the clean stand, which only gets the module by ZIP):
 * the browser of the scenario answers requests for the module's resources (loader, manifest, skin, chunks) with
 * the files of the local build in src/…/resources. Nothing on the stand changes; the result is not a PACKAGE proof.
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { test, type Page } from '@playwright/test'
import { isClean, repoRoot, target } from './env'
import { isolateNetwork, useLocalBuild, waitForShell } from './support'

const shotsDir = process.env['MU_SHOTS_DIR'] ?? (isClean ? resolve(repoRoot, `.local/shots/${target}`) : '')
const widths = (process.env['MU_SHOTS_WIDTHS'] ?? '1440,1024,768,412').split(',').map((value) => Number.parseInt(value, 10))
const onlyScreens = (process.env['MU_SHOTS_SCREENS'] ?? '').split(',').filter((value) => value !== '')
const modes = (process.env['MU_SHOTS_MODES'] ?? 'theme,standard').split(',')
const zoom = Number.parseFloat(process.env['MU_SHOTS_ZOOM'] ?? '1')
const localBuild = process.env['MU_SHOTS_LOCAL_BUILD'] === '1'

interface Screen {
  id: string
  url: (page: Page) => Promise<string | null>
  /** Opens an overlay after the page has loaded. */
  prepare?: (page: Page) => Promise<void>
}

const fixed = (url: string) => () => Promise.resolve(url)

function firstRecord(module: string, view = 'Detail', extra = ''): (page: Page) => Promise<string | null> {
  return async (page) => {
    await page.goto(`index.php?module=${module}&view=List`)
    const id = await page.locator('tr.listViewEntries[data-id]').first().getAttribute('data-id', { timeout: 10_000 }).catch(() => null)
    return id === null ? null : `index.php?module=${module}&view=${view}&record=${id}${extra}`
  }
}

const screens: Screen[] = [
  { id: 'home', url: fixed('index.php?module=Home&view=DashBoard') },
  { id: 'accounts-list', url: fixed('index.php?module=Accounts&view=List') },
  { id: 'accounts-detail', url: firstRecord('Accounts') },
  { id: 'accounts-details-tab', url: firstRecord('Accounts', 'Detail', '&mode=showDetailViewByMode&requestMode=full') },
  { id: 'accounts-edit', url: firstRecord('Accounts', 'Edit') },
  { id: 'contacts-list', url: fixed('index.php?module=Contacts&view=List') },
  { id: 'salesorder-detail', url: firstRecord('SalesOrder', 'Detail', '&mode=showDetailViewByMode&requestMode=full') },
  { id: 'salesorder-edit', url: firstRecord('SalesOrder', 'Edit') },
  { id: 'calendar', url: fixed('index.php?module=Calendar&view=Calendar') },
  { id: 'reports', url: fixed('index.php?module=Reports&view=List') },
  { id: 'settings', url: fixed('index.php?module=Vtiger&parent=Settings&view=Index') },
  { id: 'module-manager', url: fixed('index.php?module=ModuleManager&parent=Settings&view=List') },
  {
    id: 'quick-create',
    url: fixed('index.php?module=Accounts&view=List'),
    prepare: async (page) => {
      await page.locator('#menubar_quickCreate').click()
      await page.locator('#menubar_quickCreate_Contacts').click()
      await page.locator('.modal-content form[name="QuickCreate"]').waitFor({ timeout: 15_000 })
      await page.waitForTimeout(500)
    },
  },
  {
    id: 'edit-select2-open',
    url: firstRecord('Accounts', 'Edit'),
    prepare: async (page) => {
      await page.locator('#EditView .select2-container').first().locator('a.select2-choice, ul.select2-choices').first().click()
      await page.waitForTimeout(300)
    },
  },
  {
    id: 'edit-validation',
    url: fixed('index.php?module=Accounts&view=Edit'),
    prepare: async (page) => {
      await page.locator('#EditView button[type="submit"]').first().click()
      await page.waitForTimeout(800)
    },
  },
  {
    id: 'edit-datepicker',
    url: firstRecord('SalesOrder', 'Edit'),
    prepare: async (page) => {
      await page.locator('#EditView input.dateField').first().click()
      await page.waitForTimeout(300)
    },
  },
  {
    id: 'notification',
    url: fixed('index.php?module=Accounts&view=List'),
    prepare: async (page) => {
      await page.evaluate(() => {
        const helper = (window as unknown as { app?: { helper?: { showSuccessNotification?: (o: object) => void; showErrorNotification?: (o: object) => void } } }).app?.helper
        helper?.showSuccessNotification?.({ message: 'Größenänderungsübersicht — Съешь же ещё этих мягких французских булок' })
        helper?.showErrorNotification?.({ message: 'Zusammenarbeitsvereinbarungen' })
      })
      await page.waitForTimeout(600)
    },
  },
  { id: 'salesorder-list', url: fixed('index.php?module=SalesOrder&view=List') },
  { id: 'leads-list', url: fixed('index.php?module=Leads&view=List') },
  {
    // Stage 06: the mega menu of the theme (the v7 app menu in the standard view).
    id: 'mega-menu',
    url: fixed('index.php?module=Accounts&view=List&app=MARKETING'),
    prepare: async (page) => {
      const trigger = page.locator('[data-mu-trigger="mega-menu"]')
      await ((await trigger.count()) > 0 ? trigger : page.locator('#appnavigator')).click()
      await page.waitForTimeout(400)
    },
  },
  {
    id: 'mega-menu-search',
    url: fixed('index.php?module=Accounts&view=List&app=MARKETING'),
    prepare: async (page) => {
      await page.locator('[data-mu-trigger="mega-menu"]').click()
      await page.locator('[data-mu-field="menu-search"]').fill('co')
      await page.waitForTimeout(300)
    },
  },
  {
    id: 'list-selected',
    url: fixed('index.php?module=Accounts&view=List'),
    prepare: async (page) => {
      const boxes = page.locator('#listview-table .listViewEntriesCheckBox')
      for (let index = 0; index < Math.min(2, await boxes.count()); index++) {
        await boxes.nth(index).check()
      }
      await page.locator('.listViewMassActions > .btn').click()
      await page.waitForTimeout(300)
    },
  },
  {
    id: 'popup-select',
    url: fixed('index.php?module=Contacts&view=Edit'),
    prepare: async (page) => {
      await page.locator('input[name="account_id"]').locator('xpath=ancestor::td[1]').locator('.relatedPopup').click()
      await page.locator('.modal.in .listViewEntries').first().waitFor({ timeout: 15_000 })
      await page.waitForTimeout(400)
    },
  },
  {
    id: 'list-actions-dropdown',
    url: fixed('index.php?module=Accounts&view=List'),
    prepare: async (page) => {
      const more = page.locator('.listViewActionsContainer .dropdown-toggle, .listViewActionsContainer [data-toggle="dropdown"]').first()
      await more.click()
      await page.waitForTimeout(300)
    },
  },
]

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  if (shotsDir === '') {
    throw new Error('MU_SHOTS_DIR is required for the dev instance (screenshots may show customer data: use the private directory)')
  }
  mkdirSync(shotsDir, { recursive: true })
})

test.beforeEach(async ({ context }) => {
  await isolateNetwork(context)
})

for (const mode of modes) {
  test(`screens: ${mode}`, async ({ browser }) => {
    test.setTimeout(1_800_000)
    for (const width of widths) {
      const context = await browser.newContext({
        storageState: resolve(repoRoot, target === 'dev' ? '.local/e2e-admin-state.json' : `.local/e2e-${target}-admin-state.json`),
        viewport: { width: Math.round(width / zoom), height: Math.round(900 / zoom) },
        deviceScaleFactor: zoom,
      })
      await isolateNetwork(context)
      if (localBuild) {
        await useLocalBuild(context)
      }
      const page = await context.newPage()
      // A control that v7 folds away on a narrow screen must not stall the run (actions have no timeout by default).
      page.setDefaultTimeout(10_000)
      await page.goto(mode === 'standard' ? 'index.php?modernui=off' : 'index.php?modernui=on')
      for (const screen of screens) {
        if (onlyScreens.length > 0 && !onlyScreens.includes(screen.id)) {
          continue
        }
        try {
          const url = await screen.url(page)
          if (url === null) {
            continue
          }
          await page.goto(url)
          await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
          if (mode === 'theme' && !localBuild) {
            await waitForShell(page)
          }
          if (screen.prepare !== undefined) {
            await screen.prepare(page)
          }
          const suffix = zoom === 1 ? '' : `-zoom${String(zoom * 100)}`
          await page.screenshot({ path: resolve(shotsDir, `${screen.id}-${String(width)}${suffix}-${mode}.png`), fullPage: false })
        } catch (error) {
          console.warn(`[visual] ${screen.id} @${String(width)} ${mode}: ${String(error).slice(0, 200)}`)
        }
      }
      await page.goto('index.php?modernui=on')
      await context.close()
    }
  })
}
