/**
 * Stage 08 — every screen the administrator can open, with the theme and without it (project "screens", both stands):
 *
 * - the catalogue is discovered on the instance, not written down: the special screens of the core (dashboard, calendar,
 *   reports, documents, import, export, recycle bin, mail, preferences), every item of the Settings menu, the list view of
 *   every module the user can open and the first record of each entity module;
 * - each screen is opened in safe mode (the same CRM without ModernUI) and with the theme, and compared: HTTP status, new
 *   uncaught errors, visible actions (links, buttons, fields) — none may disappear, none may be covered by something
 *   else, no horizontal scrolling of the page that v7 does not have;
 * - the level the theme gives the screen is recorded (docs/compatibility.md §8): `full` (skin and navigation islands),
 *   `skin` (an unknown page shell: stylesheet only), `standard` (no theme resources: excluded screen, standard view with the
 *   v7 navigation), and the adapters of extensions mounted on it.
 *
 * Read-only: no record, setting or file of the CRM changes (the pages are only opened). The report (metrics, URLs and
 * keys of actions, no field values) goes to .local/e2e-reports/<target>/screens-<label>.json. MU_SCREENS_SHOTS_DIR
 * saves a screenshot of each screen in both modes (dev instance: the private data directory — the pages show customer
 * data). MU_SCREENS=prefix,prefix narrows the run (ids: core:…, settings:…, list:…, detail:…).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { crmUrl, isClean, reportDir, stateFile, target } from './env'
import { isolateNetwork } from './support'
import { bootstrap } from './settings-api'

test.describe.configure({ mode: 'serial' })

const shotsDir = process.env['MU_SCREENS_SHOTS_DIR'] ?? ''
const only = (process.env['MU_SCREENS'] ?? '').split(',').map((value) => value.trim()).filter((value) => value !== '')
const label = process.env['MU_SCREENS_LABEL'] ?? 'run'
/**
 * MU_SCREENS_EXTRA: a JSON file with more screens of this instance — [{id, url, open?}] where open is a selector of the
 * element that opens an overlay (after "row:" the first row of the list is selected first). Screens of extensions that the
 * discovery does not reach (template editors, designers, dashboards of extensions); the file of a dev instance lives
 * outside git (.local/).
 */
const extraFile = process.env['MU_SCREENS_EXTRA'] ?? ''

type Mode = 'off' | 'on'

/**
 * Pages whose server side calls the vendor's servers (marketplace catalogues): not opened on the dev instance, a copy of a
 * working CRM with its licences. The clean stand has no internet, so there they are opened.
 */
const VENDOR_PAGES = ['ExtensionStore', 'ITS4YouInstaller']

interface Screen {
  id: string
  url: string
  /** Opens an overlay of the page (dialog, popup, menu) after it has loaded; false: this CRM has no such trigger. */
  prepare?: (page: Page) => Promise<boolean>
}

/** Clicks the first element of a selector the way its handler expects (also inside a closed "More" menu of v7). */
function trigger(selector: string, wait = 'body'): (page: Page) => Promise<boolean> {
  return async (page) => {
    const element = page.locator(selector).first()
    if ((await element.count()) === 0) {
      return false
    }
    await element.evaluate((node: HTMLElement) => {
      node.click()
    })
    await page.locator(wait).first().waitFor({ state: 'visible', timeout: 20_000 })
    return true
  }
}

/** Steps of a wizard: click the first selector, wait for the second (the next step of v7, nothing is saved). */
function steps(...pairs: [string, string][]): (page: Page) => Promise<boolean> {
  return async (page) => {
    for (const [click, wait] of pairs) {
      const button = page.locator(click).first()
      if ((await button.count()) === 0) {
        return false
      }
      await button.click()
      await page.locator(wait).first().waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
    }
    return true
  }
}

/** Selects the first row of a list, then runs the action (mass actions need a selection). */
function withFirstRow(action: (page: Page) => Promise<boolean>): (page: Page) => Promise<boolean> {
  return async (page) => {
    const box = page.locator('#listview-table .listViewEntriesCheckBox').first()
    if ((await box.count()) === 0) {
      return false
    }
    await box.check()
    return action(page)
  }
}

const MODAL = '.modal.in .modal-content, .myModal .modal-content, #overlayPageContent.in .modal-content'

/** Dialogs, popups and menus of the core v7 (read-only: they are opened, never submitted). */
const OVERLAYS: Screen[] = [
  { id: 'overlay:import', url: 'index.php?module=Contacts&view=List', prepare: trigger('button[onclick*="triggerImportAction"]', '#overlayPageContent.in, .overlayPageContent.in') },
  { id: 'overlay:export', url: 'index.php?module=Contacts&view=List', prepare: trigger('a[onclick*="triggerExportAction"]', '#overlayPageContent.in, .overlayPageContent.in, .modal.in') },
  { id: 'overlay:find-duplicates', url: 'index.php?module=Contacts&view=List', prepare: trigger('a[onclick*="showDuplicateSearchForm"]', MODAL) },
  { id: 'overlay:mass-edit', url: 'index.php?module=Contacts&view=List', prepare: withFirstRow(trigger('[onclick*="triggerMassEdit"]', MODAL)) },
  { id: 'overlay:send-email', url: 'index.php?module=Contacts&view=List', prepare: withFirstRow(trigger('a[onclick*="triggerSendEmail"]', MODAL)) },
  { id: 'overlay:transfer-owner', url: 'index.php?module=Contacts&view=List', prepare: withFirstRow(trigger('a[onclick*="triggerTransferOwnership"]', MODAL)) },
  { id: 'overlay:add-comment', url: 'index.php?module=Contacts&view=List', prepare: withFirstRow(trigger('[onclick*="showAddComment"], [onclick*="triggerMassAction"][id$="LBL_ADD_COMMENT"]', MODAL)) },
  { id: 'overlay:quick-create-event', url: 'index.php?module=Home&view=DashBoard', prepare: async (page) => {
    if ((await page.locator('#menubar_quickCreate_Events').count()) === 0) {
      return false
    }
    await page.locator('#menubar_quickCreate').click()
    await page.locator('#menubar_quickCreate_Events').click()
    await page.locator('form[name="QuickCreate"]').waitFor({ timeout: 20_000 })
    return true
  } },
  { id: 'overlay:dashboard-widgets', url: 'index.php?module=Home&view=DashBoard', prepare: async (page) => {
    const button = page.locator('.dashBoardContainer .addButton.dropdown-toggle, button.dropdown-toggle:has-text("widget"), .dashboardHeading .dropdown-toggle').first()
    if ((await button.count()) === 0) {
      return false
    }
    await button.click()
    await page.locator('.dropdown-menu:visible').first().waitFor({ timeout: 10_000 })
    return true
  } },
  { id: 'overlay:document-add', url: 'index.php?module=Documents&view=List', prepare: async (page) => {
    const button = page.locator('#Documents_listView_basicAction_LBL_ADD_RECORD, .module-action-content .dropdown-toggle:has(.fa-plus)').first()
    if ((await button.count()) === 0) {
      return false
    }
    await button.click()
    await page.waitForTimeout(500)
    const upload = page.locator('a[onclick*="uploadTo"][onclick*="Vtiger"], a[href*="uploadTo"][href*="Vtiger"]').first()
    if ((await upload.count()) > 0) {
      await upload.evaluate((node: HTMLElement) => {
        node.click()
      })
      await page.locator(MODAL).first().waitFor({ timeout: 20_000 })
    }
    return true
  } },
  { id: 'overlay:reference-popup', url: 'index.php?module=Contacts&view=Edit', prepare: trigger('#EditView .relatedPopup', '.popupModal .modal-content, #popupModal .modal-content, .modal.in .modal-content') },
  { id: 'overlay:layout-add-field', url: 'index.php?module=LayoutEditor&parent=Settings&view=Index&sourceModule=Contacts', prepare: trigger('.addCustomField', MODAL) },
  { id: 'overlay:calendar-add-event', url: 'index.php?module=Calendar&view=Calendar', prepare: trigger('button[onclick*="Events"][onclick*="QuickCreate"], button:has(.fa-plus):has-text("Event"), .module-action-content button.addButton', MODAL) },
]

interface Snapshot {
  status: number | null
  finalUrl: string
  level: 'full' | 'skin' | 'standard'
  islands: string[]
  adapters: string[]
  failed: string | null
  overflow: number
  actions: string[]
  covered: string[]
  railMissing: string[]
  errors: string[]
}

interface Result {
  id: string
  url: string
  off: Snapshot | null
  on: Snapshot | null
  missing: string[]
  newlyCovered: string[]
  newErrors: string[]
  overflow: number
  problem: string | null
}

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: stateFile('admin') })
  context.setDefaultTimeout(15_000)
  context.setDefaultNavigationTimeout(60_000)
  await isolateNetwork(context)
  return context.newPage()
}

function withMode(url: string, mode: Mode): string {
  return `${url}${url.includes('?') ? '&' : '?'}modernui=${mode}`
}

/** CRM link of an href on the page, as index.php?… (null for other targets). */
function crmPath(raw: string | null): string | null {
  if (raw === null || raw === '' || raw.startsWith('#') || /^javascript:/i.test(raw)) {
    return null
  }
  const base = new URL(crmUrl())
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return null
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    return null
  }
  const file = url.pathname.slice(base.pathname.length)
  return file === 'index.php' || file === '' ? `index.php${url.search}` : null
}

/** URL of the first row of a list view (data-recordurl of v7 rows, or the record id), or null. */
async function firstRow(page: Page, list: string): Promise<string | null> {
  const response = await page.goto(list)
  if (response === null || response.status() >= 400) {
    return null
  }
  const row = page.locator('tr.listViewEntries[data-id]').first()
  if ((await row.count()) === 0) {
    return null
  }
  const recordUrl = crmPath(await row.getAttribute('data-recordurl'))
  if (recordUrl !== null) {
    return recordUrl
  }
  const id = await row.getAttribute('data-id')
  const module = new URL(list, crmUrl()).searchParams.get('module') ?? ''
  return id === null ? null : `index.php?module=${module}&view=Detail&record=${id}`
}

/** Screens of the instance: core special screens, the Settings menu, list and first record of every module. */
async function discover(page: Page): Promise<Screen[]> {
  await page.goto(withMode('index.php?module=Home&view=DashBoard', 'off'))
  const me = await page.evaluate(() => {
    const id = (window as unknown as { _USERMETA?: { id?: unknown } })._USERMETA?.id
    return typeof id === 'string' || typeof id === 'number' ? String(id) : ''
  })
  expect(me, 'id of the signed-in user (_USERMETA)').toMatch(/^\d+$/)
  const screens: Screen[] = [
    { id: 'core:dashboard', url: 'index.php?module=Home&view=DashBoard' },
    { id: 'core:calendar', url: 'index.php?module=Calendar&view=Calendar' },
    { id: 'core:calendar-shared', url: 'index.php?module=Calendar&view=SharedCalendar' },
    { id: 'core:calendar-list', url: 'index.php?module=Calendar&view=List' },
    { id: 'core:task-edit', url: 'index.php?module=Calendar&view=Edit' },
    { id: 'core:event-edit', url: 'index.php?module=Events&view=Edit' },
    { id: 'core:reports', url: 'index.php?module=Reports&view=List' },
    { id: 'core:report-new', url: 'index.php?module=Reports&view=Edit' },
    { id: 'core:chart-report-new', url: 'index.php?module=Reports&view=ChartEdit' },
    { id: 'core:documents', url: 'index.php?module=Documents&view=List' },
    { id: 'core:document-new', url: 'index.php?module=Documents&view=Edit' },
    { id: 'core:import', url: 'index.php?module=Contacts&view=Import' },
    { id: 'core:find-duplicates', url: 'index.php?module=Contacts&view=FindDuplicates&fields[]=lastname' },
    { id: 'core:recycle-bin', url: 'index.php?module=RecycleBin&view=List' },
    { id: 'core:mail-manager', url: 'index.php?module=MailManager&view=List' },
    { id: 'core:email-templates', url: 'index.php?module=EmailTemplates&view=List' },
    { id: 'core:my-preferences', url: `index.php?module=Users&view=PreferenceDetail&parent=Settings&record=${me}` },
    { id: 'core:my-preferences-edit', url: `index.php?module=Users&view=PreferenceEdit&parent=Settings&record=${me}` },
    { id: 'core:calendar-settings', url: `index.php?module=Users&parent=Settings&view=Calendar&record=${me}` },
    { id: 'core:settings', url: 'index.php?module=Vtiger&parent=Settings&view=Index' },
    { id: 'core:layout-editor', url: 'index.php?module=LayoutEditor&parent=Settings&view=Index&sourceModule=Contacts' },
    { id: 'core:roles', url: 'index.php?module=Roles&parent=Settings&view=Index' },
    { id: 'core:workflow-new', url: 'index.php?module=Workflows&parent=Settings&view=Edit&source_module=Contacts' },
    { id: 'core:picklist', url: 'index.php?parent=Settings&module=Picklist&view=Index&source_module=Contacts' },
  ]

  // Every item of the Settings menu (the sidebar of the Settings pages).
  await page.goto(withMode('index.php?module=Vtiger&parent=Settings&view=Index', 'off'))
  const items = await page.locator('.settingsgroup a.menuItemLabel[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
  const seen = new Set(screens.map((screen) => screen.url))
  for (const raw of items) {
    const url = crmPath(raw)
    if (url === null || seen.has(url)) {
      continue
    }
    seen.add(url)
    const query = new URL(url, crmUrl()).searchParams
    screens.push({ id: `settings:${query.get('module') ?? ''}-${query.get('view') ?? query.get('action') ?? ''}`, url })
  }
  // The first entries of the main Settings lists (their detail or edit pages).
  for (const [id, list] of [
    ['settings-detail:user', 'index.php?module=Users&parent=Settings&view=List'],
    ['settings-detail:profile', 'index.php?module=Profiles&parent=Settings&view=List'],
    ['settings-detail:group', 'index.php?module=Groups&parent=Settings&view=List'],
    ['settings-detail:workflow', 'index.php?module=Workflows&parent=Settings&view=List'],
  ] as const) {
    const url = await firstRow(page, withMode(list, 'off'))
    if (url !== null) {
      screens.push({ id, url })
    }
  }

  // Edit pages of the Settings (opened, never saved).
  for (const [id, url] of [
    ['settings-edit:user', `index.php?module=Users&parent=Settings&view=Edit&record=${me}`],
    ['settings-edit:role', 'index.php?module=Roles&parent=Settings&view=Edit&record=H2'],
    ['settings-edit:company', 'index.php?parent=Settings&module=Vtiger&view=CompanyDetailsEdit'],
    ['settings-edit:outgoing-server', 'index.php?parent=Settings&module=Vtiger&view=OutgoingServerEdit'],
    ['settings-edit:config', 'index.php?module=Vtiger&parent=Settings&view=ConfigEditorEdit'],
    ['settings-edit:picklist-dependency', 'index.php?parent=Settings&module=PickListDependency&view=Edit'],
  ] as const) {
    screens.push({ id, url })
  }
  for (const screen of [...screens]) {
    if (screen.id === 'settings-detail:profile' || screen.id === 'settings-detail:group') {
      screens.push({ id: screen.id.replace('detail', 'edit'), url: screen.url.replace(/view=Detail/, 'view=Edit') })
    }
  }
  for (const [id, list] of [['core:email-template-edit', 'index.php?module=EmailTemplates&view=List'], ['settings-edit:webform', 'index.php?module=Webforms&parent=Settings&view=List']] as const) {
    const url = await firstRow(page, withMode(list, 'off'))
    if (url !== null) {
      screens.push({ id, url: url.replace(/view=Detail/, 'view=Edit') })
    }
  }

  // Modules of the user (the menu of the theme knows all of them, hidden ones included).
  const data = await bootstrap(page)
  const menu = data['menu'] as { groups: { items: { module: string; url: string }[] }[]; modules: string[] }
  const urls = new Map<string, string>()
  for (const group of menu.groups) {
    for (const item of group.items) {
      if (item.module !== '' && !urls.has(item.module)) {
        urls.set(item.module, item.url)
      }
    }
  }
  for (const module of menu.modules) {
    const url = urls.get(module) ?? `index.php?module=${module}&view=List`
    if (!seen.has(url)) {
      seen.add(url)
      screens.push({ id: `list:${module}`, url })
    }
    const detail = await firstRow(page, withMode(`index.php?module=${module}&view=List`, 'off'))
    if (detail !== null && !seen.has(detail)) {
      seen.add(detail)
      screens.push({ id: `detail:${module}`, url: detail })
    }
  }
  // Reports: the first report of each kind.
  await page.goto(withMode('index.php?module=Reports&view=List', 'off'))
  const reportUrls = await page.locator('tr.listViewEntries[data-recordurl]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-recordurl') ?? ''))
  for (const view of ['Detail', 'ChartDetail']) {
    const url = reportUrls.map(crmPath).find((candidate) => candidate?.includes(`view=${view}&`))
    if (url && !seen.has(url)) {
      seen.add(url)
      screens.push({ id: `core:report-${view.toLowerCase()}`, url })
      if (view === 'ChartDetail') {
        // The chart settings of the report: its wizard up to the chart step (nothing is saved before "Generate").
        screens.push({
          id: 'core:chart-report-settings',
          url: url.replace('view=ChartDetail', 'view=ChartEdit'),
          prepare: steps(['form button.nextStep:visible', '#chart_report_step2'], ['#chart_report_step2 button.nextStep:visible', '#chart_report_step3']),
        })
      }
    }
  }
  screens.push(...OVERLAYS)
  if (extraFile !== '') {
    const extra = JSON.parse(readFileSync(extraFile, 'utf8')) as { id: string; url: string; open?: string }[]
    for (const entry of extra) {
      const open = entry.open
      const prepare = open === undefined ? undefined
        : open.startsWith('row:') ? withFirstRow(trigger(open.slice(4), MODAL)) : trigger(open, `${MODAL}, .popover.in, .dropdown-menu:visible`)
      screens.push({ id: `extra:${entry.id}`, url: entry.url, ...(prepare !== undefined ? { prepare } : {}) })
    }
  }
  return screens.filter((screen) => (only.length === 0 || only.some((prefix) => screen.id.startsWith(prefix)))
    && (isClean || !VENDOR_PAGES.some((module) => screen.url.includes(`module=${module}&`))))
}

/** Until the requests of the page are done (widgets and extensions load after ready); polling pages give up after 5 s. */
async function settle(page: Page, mode: Mode): Promise<void> {
  await page.waitForLoadState('load').catch(() => undefined)
  if (mode === 'on') {
    await page.waitForFunction(() => {
      const html = document.documentElement
      return html.classList.contains('mu-shell-ready') || html.hasAttribute('data-mu-failed') || html.getAttribute('data-mu-level') === 'skin'
        || document.querySelector('script[src*="modules/ModernUI/resources/loader.js"]') === null
    }, undefined, { timeout: 15_000 }).catch(() => undefined)
  }
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
  await page.waitForTimeout(400)
}

async function snapshot(page: Page, screen: Screen, mode: Mode): Promise<Snapshot> {
  const errors: string[] = []
  const onError = (error: Error): void => {
    errors.push(error.message.replace(/\s+/g, ' ').slice(0, 200))
  }
  page.on('pageerror', onError)
  let status: number | null = null
  let menuLinks: string[] = []
  try {
    const response = await page.goto(withMode(screen.url, mode), { timeout: 60_000 })
    status = response?.status() ?? null
    await settle(page, mode)
    // A module can have a nonstandard default view. Check the actual mega-menu links as well as the context bar,
    // instead of assuming that every view outside a hardcoded list needs its own context entry. Read before a dialog or
    // menu of the screen is opened (stage 17: also for the prepared screens).
    const menuTrigger = page.locator('[data-mu-trigger="mega-menu"]')
    if (mode === 'on' && await menuTrigger.isVisible()) {
      await menuTrigger.click()
      const panel = page.locator('[data-mu-panel="mega-menu"]')
      await expect(panel).toBeVisible()
      menuLinks = await panel.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
      await panel.press('Escape')
      await expect(panel).toBeHidden()
    }
    if (screen.prepare !== undefined) {
      if (!(await screen.prepare(page))) {
        throw new SkipScreen()
      }
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)
      await page.waitForTimeout(800)
    }
  } finally {
    page.off('pageerror', onError)
  }
  const measure = async (region: string | null): Promise<Omit<Snapshot, 'status' | 'errors'>> => page.evaluate(({ region, menuLinks }) => {
    const html = document.documentElement
    // The navigation of v7 the shell may replace (app menu, module strip, logo) is compared separately: the module strip
    // below, the app menu by the navigation scenarios of stage 06. Links that switch the safe mode differ by design.
    // The current-filter breadcrumb duplicates the active link measured inside the original filter panel.
    const skip = ['[data-mu-root]', '#mu-overlay-root', '#appnavigator', '#app-menu', '#modnavigator', '.company-logo', '.essentials-toggle', '.current-filter-name', 'a[href*="modernui="]'].join(',')
    // The v7 module strip is gone on the screens of the theme (stage 11): the entries that only the strip offers — the views
    // of the module of the page when it has several (the calendar: calendar, shared calendar, list), another view or a link
    // with its own parameters — must be in the context navigation of the toolbar. The other modules of the strip are
    // entries of the theme menu (the mega menu, checked by the navigation scenarios). A strip with an entry without a link
    // stays (html[data-mu-keep-rail]).
    const destination = (raw: string): string => {
      const url = new URL(raw, document.baseURI)
      url.searchParams.delete('app')
      url.searchParams.sort()
      return url.search
    }
    const meta = (window as unknown as { _META?: { module?: unknown } })._META
    const pageModule = typeof meta?.module === 'string' && meta.module !== '' ? meta.module : new URL(location.href).searchParams.get('module') ?? ''
    const railMissing: string[] = []
    const strip = document.querySelector('#modnavigator > .mod-switcher-container')
    if (strip !== null && html.getAttribute('data-mu-level') === 'islands' && !html.hasAttribute('data-mu-keep-rail') && getComputedStyle(strip).display !== 'none' && strip.getBoundingClientRect().width === 0) {
      const context = new Set(Array.from(document.querySelectorAll('[data-mu-root="context-nav"] a[href]')).map((link) => destination(link.getAttribute('href') ?? '')))
      const menu = new Set(menuLinks.map(destination))
      const links = Array.from(strip.querySelectorAll('a[href]')).map((link) => link.getAttribute('href') ?? '')
        .filter((href) => href !== '' && !href.startsWith('#') && !href.startsWith('javascript'))
      const views = links.filter((href) => new URL(href, document.baseURI).searchParams.get('module') === pageModule).length
      for (const href of links) {
        const url = new URL(href, document.baseURI)
        const extra = Array.from(url.searchParams.keys()).filter((key) => !['module', 'view', 'app', 'parent'].includes(key))
        const ofPage = url.searchParams.get('module') === pageModule
        const own = (ofPage && views > 1) || extra.length > 0 || !['', 'List', 'Index', 'DashBoard', 'Calendar'].includes(url.searchParams.get('view') ?? '')
        if (own && !context.has(destination(href)) && !menu.has(destination(href))) {
          railMissing.push(`rail|${href}`)
        }
      }
    }
    // While a dialog is open, the page behind it takes no clicks in v7 either: only the dialog is compared.
    const dialog = document.querySelector('.modal.in') !== null
    const visible = (element: Element): boolean => {
      // The original select of a Select2 control is clipped away on purpose; its action is the visible Select2 control.
      if (element.matches('.select2-offscreen') || (dialog && element.closest('.modal.in') === null)) {
        return false
      }
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) {
        return false
      }
      // The collapsed global search of the cloud header (stage 11) is a transparent field under its search icon: it takes
      // the click and opens; it is reachable although it draws nothing until then.
      if (element.matches('.search-link .keyword-input') && document.documentElement.classList.contains('mu-shell-ready')) {
        return element.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })
      }
      return element.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })
    }
    const keyOf = (element: Element): string => {
      const tag = element.tagName.toLowerCase()
      const id = element.id
      const name = element.getAttribute('name') ?? ''
      // textContent of an element is never null.
      const type = element.getAttribute('type') ?? ''
      const href = (element.getAttribute('href') ?? '').replace(/([?&])modernui=(?:on|off)&?/, '$1').replace(/[?&]$/, '')
      const text = element.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)
      // Anonymous search fields in separate disclosures have different roles; do not merge them as one empty key.
      const title = tag === 'input' && id === '' && name === '' ? element.className : element.getAttribute('title') ?? element.getAttribute('aria-label') ?? ''
      return [tag, id, name, type, href, id !== '' || name !== '' ? '' : text, id !== '' || name !== '' || text !== '' ? '' : title].join('|')
    }
    const actions: string[] = []
    const covered: string[] = []
    for (const element of Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [onclick]'))) {
      // Stage 12 moves disabled mass actions out of the toolbar; they are unavailable in both views (stage 17: the record
      // actions of the recycle bin the same way — they appear with a selection, special-screens checks it).
      if (element.closest(skip) !== null || !visible(element) || (region !== null && element.closest(region) === null)
        || element.matches(':is(.listViewActionsContainer, .recordDependentListActions) > button:disabled')) {
        continue
      }
      const key = keyOf(element)
      actions.push(key)
      const rect = element.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
        continue
      }
      // Scrolled out of its own scroll box (a list of the sidebar, a table with its own scroll bars, a popup): reachable by
      // scrolling that box, not covered — the theme's taller rows put other rows there than v7 does.
      let clipped = false
      for (let box = element.parentElement; box !== null && box !== document.body; box = box.parentElement) {
        const style = getComputedStyle(box)
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
          const area = box.getBoundingClientRect()
          if (x < area.left || x > area.right || y < area.top || y > area.bottom) {
            clipped = true
            break
          }
        }
      }
      if (clipped) {
        continue
      }
      const hit = document.elementFromPoint(x, y)
      if (hit !== null && hit !== element && !element.contains(hit) && !hit.contains(element)) {
        // Labels that wrap their control are not "covering". Fixed bars of v7 at the bottom of the window (footer, the save
        // bar of forms) cover whatever is under them: with the favorites bar the page starts 42 px lower, so other rows are
        // there — the rows can be scrolled out, nothing is lost.
        const label = hit.closest('label')
        // Custom scroll bars drawn over the edge of their box (mCustomScrollbar, perfect-scrollbar) cover what can be scrolled.
        // … and so does a menu the scenario opened on purpose (its place depends on the button that opened it).
        const scrollbar = hit.closest('.mCSB_scrollTools, .ps-scrollbar-x-rail, .ps-scrollbar-y-rail, .ps__rail-x, .ps__rail-y, .dropdown-menu, .popover, .select2-drop') !== null
        let fixedBottom = false
        for (let node: Element | null = hit; node !== null && node !== document.body; node = node.parentElement) {
          const position = getComputedStyle(node).position
          if ((position === 'fixed' || position === 'sticky' || position === 'absolute') && node.getBoundingClientRect().top > window.innerHeight / 2) {
            fixedBottom = true
            break
          }
        }
        if (!label?.contains(element) && !fixedBottom && !scrollbar) {
          const classes = typeof hit.className === 'string' ? hit.className : ''
          const by = `${hit.tagName.toLowerCase()}${hit.id !== '' ? `#${hit.id}` : ''}.${classes.trim().split(/\s+/).slice(0, 3).join('.')}`
          covered.push(`${key} ⟂ ${by}`)
        }
      }
    }
    const skin = document.querySelector('link[rel="stylesheet"][href*="modules/ModernUI/resources/dist/assets/skin-"]') !== null
    const levelAttribute = html.getAttribute('data-mu-level')
    return {
      finalUrl: location.pathname + location.search,
      level: !skin ? 'standard' as const : levelAttribute === 'islands' ? 'full' as const : 'skin' as const,
      islands: (html.getAttribute('data-mu-islands') ?? '').split(/\s+/).filter((value) => value !== ''),
      adapters: (html.getAttribute('data-mu-adapters') ?? '').split(/\s+/).filter((value) => value !== ''),
      failed: html.getAttribute('data-mu-failed'),
      overflow: html.scrollWidth - html.clientWidth,
      actions,
      covered,
      railMissing,
    }
  }, { region, menuLinks })
  const state = await measure(null)
  // Controls inside native disclosures are reachable after one click. Measure each panel on its own so that its
  // intentional overlap with the table does not count as a covered table action. Preserve duplicate action counts.
  if (mode === 'on' && screen.prepare === undefined) {
    const maximum = (left: string[], right: string[]): string[] => {
      const counts = (items: string[]): Map<string, number> => {
        const result = new Map<string, number>()
        for (const item of items) result.set(item, (result.get(item) ?? 0) + 1)
        return result
      }
      const result = counts(left)
      for (const [key, value] of counts(right)) result.set(key, Math.max(value, result.get(key) ?? 0))
      return [...result].flatMap(([key, value]) => Array<string>(value).fill(key))
    }
    const globalSearch = page.locator('.search-link .keyword-input')
    if (await globalSearch.isVisible()) {
      await globalSearch.click()
      const panel = await measure('.search-link')
      state.actions = maximum(state.actions, panel.actions)
      state.covered = maximum(state.covered, panel.covered)
      await globalSearch.press('Escape')
    }
    for (const [trigger, region] of [
      ['.mu-list-search', '#listViewContent .searchRow'],
      ['.mu-list-filter', '#sidebar-essentials'],
      ['.mu-list-more', '[data-mu-list-import]'],
    ] as const) {
      const button = page.locator(trigger)
      if (!await button.isVisible()) continue
      if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
      await expect(page.locator(region).first()).toBeVisible()
      const panel = await measure(region)
      state.actions = maximum(state.actions, panel.actions)
      state.covered = maximum(state.covered, panel.covered)
      await button.click()
    }
  }
  if (shotsDir !== '') {
    await page.screenshot({ path: resolve(shotsDir, `${screen.id.replace(/[^A-Za-z0-9_-]+/g, '_')}-${mode}.png`) }).catch(() => undefined)
  }
  return { status, errors, ...state }
}

/** The CRM has no trigger for an overlay screen: the screen does not exist there. */
class SkipScreen extends Error {}

function multisetMinus(left: string[], right: string[]): string[] {
  const counts = new Map<string, number>()
  for (const key of right) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const result: string[] = []
  for (const key of left) {
    const count = counts.get(key) ?? 0
    if (count > 0) {
      counts.set(key, count - 1)
    } else {
      result.push(key)
    }
  }
  return result
}

test('every screen keeps its actions under the theme', async ({ browser }) => {
  test.setTimeout(4 * 60 * 60_000)
  if (target === 'dev' && shotsDir !== '' && !shotsDir.startsWith('/')) {
    throw new Error('MU_SCREENS_SHOTS_DIR must be an absolute path (the private data directory on the dev instance)')
  }
  if (shotsDir !== '') {
    mkdirSync(shotsDir, { recursive: true })
  }
  const page = await adminPage(browser)
  // Dialogs some screens open on load (alerts of extensions) are dismissed, like a user closing them.
  page.on('dialog', (dialog) => {
    void dialog.dismiss().catch(() => undefined)
  })
  const screens = await discover(page)
  expect(screens.length, 'screens found on the instance').toBeGreaterThan(only.length > 0 ? 0 : isClean ? 20 : 40)
  const results: Result[] = []
  for (const screen of screens) {
    console.log(`[screens] ${screen.id}`)
    const result: Result = { id: screen.id, url: screen.url, off: null, on: null, missing: [], newlyCovered: [], newErrors: [], overflow: 0, problem: null }
    try {
      result.off = await snapshot(page, screen, 'off')
      result.on = await snapshot(page, screen, 'on')
      result.missing = [...multisetMinus(result.off.actions, result.on.actions), ...result.on.railMissing]
      // Compared by the element; what covers it is kept for the report.
      const offCovered = result.off.covered.map((entry) => entry.split(' ⟂ ')[0] ?? entry)
      const onKeys = result.on.covered.map((entry) => entry.split(' ⟂ ')[0] ?? entry)
      const lost = multisetMinus(onKeys, offCovered)
      result.newlyCovered = result.on.covered.filter((entry) => lost.includes(entry.split(' ⟂ ')[0] ?? entry))
      result.newErrors = result.on.errors.filter((error) => !(result.off?.errors.includes(error) ?? false))
      // Horizontal scrolling of the page: a regression when v7 has none, or when the theme adds much more to what v7 has
      // (a slightly wider button in a row that already overflows in v7 is not).
      const offOverflow = Math.max(0, result.off.overflow)
      result.overflow = offOverflow <= 1 ? Math.max(0, result.on.overflow) : Math.max(0, result.on.overflow - offOverflow - 24)
      if (result.off.status !== result.on.status) {
        result.problem = `status ${String(result.off.status)} → ${String(result.on.status)}`
      } else if (result.on.failed !== null) {
        result.problem = `shell failed: ${result.on.failed}`
      }
    } catch (error) {
      if (error instanceof SkipScreen) {
        continue
      }
      result.problem = error instanceof Error ? error.message.split('\n')[0] ?? 'error' : 'error'
    }
    results.push(result)
  }
  await page.context().close()

  mkdirSync(reportDir(), { recursive: true })
  const file = resolve(reportDir(), `screens-${label}.json`)
  writeFileSync(file, `${JSON.stringify({ target, at: new Date().toISOString(), screens: results }, null, 1)}\n`)
  const levels = { full: 0, skin: 0, standard: 0 }
  for (const result of results) {
    if (result.on !== null) {
      levels[result.on.level] += 1
    }
  }
  const failing = results.filter((result) => result.problem !== null || result.missing.length > 0 || result.newlyCovered.length > 0
    || result.newErrors.length > 0 || result.overflow > 1)
  console.log(`screens: ${String(results.length)} (full ${String(levels.full)}, skin ${String(levels.skin)}, standard ${String(levels.standard)}); report ${file}`)
  for (const result of failing) {
    console.log(`  ${result.id}: ${result.problem ?? ''} missing ${JSON.stringify(result.missing.slice(0, 5))} covered ${JSON.stringify(result.newlyCovered.slice(0, 5))} errors ${JSON.stringify(result.newErrors.slice(0, 3))} overflow ${String(result.overflow)}`)
  }
  expect(failing.map((result) => result.id), 'screens with lost or covered actions, new errors or scrolling').toEqual([])
})
