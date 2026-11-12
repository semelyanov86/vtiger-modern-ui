/**
 * Stage 15 (V09): the system settings of the CRM in the cloud layout of the settings (docs/design.md §13.11,
 * docs/architecture.md §7.12). Every check compares with the same CRM without the theme (modernui=off):
 *
 * - the catalog of the start page is the native menu of the settings — the same groups, items, URLs and summary as v7,
 *   all of them visible, laid out as the cloud catalog; the native search finds the same items, an own empty state,
 *   keyboard order; "Back to CRM" and the breadcrumb lead back without editing a URL;
 * - inner pages (Users, Roles, Profiles, Layouts & Fields, Picklists, Workflows, Module Manager): the frame of the
 *   cloud, the same native actions, drag and drop and switches as v7, dialogs open and cancel without saving;
 * - RU/EN/DE of the theme, 1024/768/412 px and 200 %, a failed shell, no scripts and the standard view;
 * - clean stand only: a restricted user sees only the own preferences; real changes through the native screens with the
 *   theme on — a role, a user of that role, a custom field, a picklist value and a simple workflow (no tasks, nothing is
 *   sent) are created, changed, checked where they take effect and deleted again through the same screens.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { cleanUserCredentials, crmUrl, isClean, repoRoot, stateFile } from './env'
import { bootstrap, clearPersonal, globalScope, patchGlobal, savePersonal } from './settings-api'
import { withMode } from './records-support'
import { isolateNetwork, signIn, waitForShell, watchErrors } from './support'

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

const HOME = 'index.php?module=Vtiger&parent=Settings&view=Index'
const PAGES = [
  { id: 'users', url: 'index.php?module=Users&parent=Settings&view=List', module: 'Users' },
  { id: 'roles', url: 'index.php?module=Roles&parent=Settings&view=Index', module: 'Roles' },
  { id: 'profiles', url: 'index.php?module=Profiles&parent=Settings&view=List', module: 'Profiles' },
  { id: 'layout', url: 'index.php?module=LayoutEditor&parent=Settings&view=Index&sourceModule=Accounts', module: 'LayoutEditor' },
  { id: 'picklist', url: 'index.php?parent=Settings&module=Picklist&view=Index&source_module=Accounts', module: 'Picklist' },
  { id: 'workflows', url: 'index.php?module=Workflows&parent=Settings&view=List', module: 'Workflows' },
  { id: 'modules', url: 'index.php?module=ModuleManager&parent=Settings&view=List', module: 'ModuleManager' },
] as const
type Locale = 'ru-RU' | 'en-US' | 'de-DE'
const dictionary = (locale: Locale): { back: string; empty: string } =>
  (JSON.parse(readFileSync(resolve(repoRoot, `frontend/src/i18n/locales/${locale}.json`), 'utf8')) as { settings: { back: string; empty: string } }).settings

let personal: Record<string, unknown> = {}
let mode: unknown

test.beforeEach(async ({ context }) => {
  await isolateNetwork(context)
})

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  mode = (await globalScope(page)).values['theme.mode']
  personal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  if (isClean) {
    await patchGlobal(page, { 'theme.mode': 'all' })
  }
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  try {
    await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
    await patchGlobal(page, { 'theme.mode': mode ?? null })
    await clearPersonal(page)
    if (Object.keys(personal).length > 0) {
      expect((await savePersonal(page, personal)).ok).toBe(true)
    }
    expect(((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values).toEqual(personal)
  } finally {
    await page.close()
  }
})

/** Opens a page of the CRM with the theme on (waits for the shell) or off (the standard view of the session). */
async function open(page: Page, url: string, theme: 'on' | 'off'): Promise<void> {
  await page.goto(withMode(url, theme))
  if (theme === 'on') {
    await waitForShell(page)
    await expect(page.locator('html')).toHaveClass(/mu-shell-ready/)
  } else {
    await expect(page.locator('html')).not.toHaveClass(/mu-shell-ready/)
  }
  await page.waitForLoadState('load')
  await page.waitForTimeout(400)
}

/** The native menu of the settings: groups and items in their order (the same nodes in both modes). */
async function catalog(page: Page): Promise<{ group: string; items: { href: string; label: string }[] }[]> {
  return page.locator('#modnavigator .settingsgroup .settingsgroup-panel').evaluateAll((panels) => panels.map((panel) => ({
    group: (panel.querySelector('.settingsgroup-accordion span')?.textContent ?? '').trim(),
    items: [...panel.querySelectorAll('a.menuItemLabel')].map((link) => ({ href: link.getAttribute('href') ?? '', label: link.textContent.trim() })),
  })))
}

async function summary(page: Page): Promise<string[]> {
  return page.locator('.settingsIndexPage .settingsSummary a').evaluateAll((links) => links.map((link) => `${link.getAttribute('href') ?? ''} ${link.textContent.replace(/\s+/g, ' ').trim()}`))
}

async function box(page: Page, selector: string): Promise<[number, number, number, number]> {
  return page.locator(selector).first().evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10) as [number, number, number, number]
  })
}

function near(actual: number, expected: number, tolerance = 4): void {
  expect(Math.abs(actual - expected), `${String(actual)} ≈ ${String(expected)}`).toBeLessThanOrEqual(tolerance)
}

/** The native search of the settings reacts to key up (instaFilta); characters outside the keyboard layout come without. */
async function search(page: Page, text: string): Promise<void> {
  const field = page.locator('.settingsgroup #settingsMenuSearch')
  await field.click()
  await field.press('Control+a')
  await field.press('Backspace')
  if (text !== '') {
    await field.pressSequentially(text, { delay: 30 })
  }
  await field.press('End')
  await page.waitForTimeout(200)
}

async function matched(page: Page): Promise<string[]> {
  return page.locator('.settingsgroup a.menuItemLabel[data-instafilta-hide="false"]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
}

/** Columns of the catalog: the distinct left edges of the visible group headings. */
async function columns(page: Page): Promise<number[]> {
  const xs = await page.locator('.settingsgroup-panel .settingsgroup-accordion span').evaluateAll((spans) => spans
    .filter((span) => span.getClientRects().length > 0)
    .map((span) => Math.round(span.getBoundingClientRect().x)))
  return [...new Set(xs)].sort((a, b) => a - b)
}

async function sidewaysScroll(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

test('catalog: the native menu of the settings is the cloud catalog with the same items and summary as v7', async ({ page }) => {
  const errors = watchErrors(page)
  await open(page, HOME, 'off')
  const native = await catalog(page)
  const nativeSummary = await summary(page)
  const nativeErrors = [...errors.page]
  expect(native.flatMap((group) => group.items).length).toBeGreaterThan(10)
  await open(page, HOME, 'on')
  expect(await catalog(page)).toEqual(native)
  expect(await summary(page)).toEqual(nativeSummary)
  // Every item and heading is visible on the start page (v7 keeps them in a closed accordion).
  const links = page.locator('#modnavigator .settingsgroup a.menuItemLabel')
  for (let index = 0; index < await links.count(); index++) {
    await expect(links.nth(index)).toBeVisible()
  }
  await expect(page.locator('.settingsIndexPage > div:first-child')).toBeHidden()
  // Header of the settings: one 53 px row with "Back to CRM", the 47 px #f5f5f5 bar with the breadcrumb; no favorites.
  const locale = (await page.locator('html').getAttribute('data-mu-locale')) as Locale
  await expect(page.locator('.mu-settings-back')).toHaveText(dictionary(locale).back)
  const row = await box(page, '#page > nav.app-fixed-navbar > .global-nav')
  near(row[1], 0, 1)
  near(row[3], 53, 1)
  const bar = await box(page, '#page > nav.app-fixed-navbar .module-action-bar')
  near(bar[1], 53, 1)
  near(bar[3], 47, 1)
  expect(await page.locator('#page > nav.app-fixed-navbar .module-action-bar').evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgb(245, 245, 245)')
  await expect(page.locator('#page > nav.app-fixed-navbar .module-action-content h4.module-title')).toBeVisible()
  await expect(page.locator('[data-mu-root="favorites"]')).toBeHidden()
  await expect(page.locator('#page > nav.app-fixed-navbar .mu-mega-root')).toBeHidden()
  // The icons of the CRM and of extensions stay in the row.
  const icons = page.locator('#navbar > .navbar-nav > li')
  for (let index = 0; index < await icons.count(); index++) {
    const icon = icons.nth(index)
    if ((await icon.evaluate((node) => getComputedStyle(node).display)) !== 'none') {
      await expect(icon).toBeInViewport()
    }
  }
  // Tiles, search and four columns as the cloud at 1440 px.
  const tile = await box(page, '.settingsSummary > a')
  near(tile[0], 15)
  near(tile[1], 111)
  near(tile[2], 265, 2)
  near(tile[3], 70, 2)
  const field = await box(page, '.settingsgroup #settingsMenuSearch')
  near(field[0], 480)
  near(field[1], 197)
  near(field[2], 300, 2)
  near(field[3], 32, 2)
  const cols = await columns(page)
  expect(cols.length).toBe(4)
  cols.forEach((x, index) => { near(x, [15, 375, 735, 1095][index] ?? 0) })
  // Open Sans of the settings family while the theme draws the cloud font.
  if ((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mu-font-family'))).includes('cloud')) {
    expect(await links.first().evaluate((node) => getComputedStyle(node).fontFamily)).toMatch(/^"?Open Sans"?/)
    expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('13px "Open Sans"') })).toBe(true)
  }
  expect(await sidewaysScroll(page)).toBeLessThanOrEqual(1)
  expect(errors.page.slice(nativeErrors.length).filter((message) => !nativeErrors.includes(message))).toEqual([])
})

test('search: the same items as the native search of v7, an own empty state and the keyboard order', async ({ page }) => {
  await open(page, HOME, 'off')
  const label = ((await page.locator('.settingsgroup a.menuItemLabel[href*="module=Picklist&"]').first().textContent()) ?? '').trim()
  const term = label.slice(0, 4)
  expect(term).toHaveLength(4)
  await search(page, term)
  const native = await matched(page)
  expect(native.length).toBeGreaterThan(0)
  await open(page, HOME, 'on')
  const all = (await catalog(page)).flatMap((group) => group.items)
  await search(page, term)
  expect(await matched(page)).toEqual(native)
  const visible = page.locator('.settingsgroup a.menuItemLabel[data-instafilta-hide="false"]')
  for (let index = 0; index < await visible.count(); index++) {
    await expect(visible.nth(index)).toBeVisible()
  }
  const other = all.find((item) => !native.includes(item.href))
  if (other !== undefined) {
    await expect(page.locator(`.settingsgroup a.menuItemLabel[href="${other.href}"]`)).toBeHidden()
  }
  await expect(page.locator('#settingsShortCutsContainer')).toBeHidden()
  // The groups without a match are gone, the remaining ones start the first column.
  expect((await columns(page))[0]).toBeLessThanOrEqual(19)
  // No matches: the own message in the language of the theme, no item.
  const locale = (await page.locator('html').getAttribute('data-mu-locale')) as Locale
  await search(page, 'zzqq')
  await expect(page.locator('.settingsgroup > .mu-settings-empty')).toBeVisible()
  await expect(page.locator('.mu-settings-empty__title')).toHaveText(dictionary(locale).empty)
  const empty = await page.locator('.mu-settings-empty__title').boundingBox()
  expect(empty).not.toBeNull()
  expect(Math.abs((empty?.x ?? 0) + (empty?.width ?? 0) / 2 - (page.viewportSize()?.width ?? 0) / 2)).toBeLessThanOrEqual(4)
  expect(await matched(page)).toEqual([])
  await expect(page.locator('.settingsgroup a.menuItemLabel').first()).toBeHidden()
  // Cleared: everything is back.
  await search(page, '')
  await expect(page.locator('.settingsgroup > .mu-settings-empty')).toBeHidden()
  await expect(page.locator(`.settingsgroup a.menuItemLabel[href="${all[0]?.href ?? ''}"]`)).toBeVisible()
  // Keyboard: Tab from the search goes to the first setting (the headings of the groups are not stops), Enter opens it.
  await page.locator('.settingsgroup #settingsMenuSearch').focus()
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.getAttribute('href') ?? '')).toBe(all[0]?.href)
  await expect(page.locator('.settingsgroup a.menuItemLabel').first()).toBeFocused()
  await Promise.all([page.waitForURL((url) => url.href.includes(all[0]?.href.replace(/^index\.php\?/, '') ?? '#')), page.keyboard.press('Enter')])
})

test('navigation: Back to CRM returns to the last page of the CRM, the catalog, the side navigation and the breadcrumb lead between settings', async ({ browser, page }) => {
  await page.goto('index.php?module=Accounts&view=List&modernui=on')
  await waitForShell(page)
  await open(page, HOME, 'on')
  const back = page.locator('.mu-settings-back')
  await expect(back).toHaveAttribute('href', /^index\.php\?module=Accounts&view=List/)
  // Into the users from the catalog; the side navigation marks it.
  await Promise.all([page.waitForURL(/module=Users&parent=Settings/), page.locator('.settingsgroup a.menuItemLabel[href*="module=Users&parent=Settings&view=List"]').first().click()])
  await waitForShell(page)
  await expect(page.locator('#modnavigator .settingsgroup-menu-color')).toHaveAttribute('href', /module=Users&parent=Settings&view=List/)
  const nav = await box(page, '#modnavigator.settingsNav')
  near(nav[0], 0, 0)
  near(nav[1], 100, 1)
  near(nav[2], 180, 1)
  // To the roles through the side navigation, home through the breadcrumb, back to the CRM through the link.
  await Promise.all([page.waitForURL(/module=Roles&parent=Settings/), page.locator('#modnavigator a.menuItemLabel[href*="module=Roles&"]').first().click()])
  await waitForShell(page)
  await expect(page.locator('#modnavigator .settingsgroup-menu-color')).toHaveAttribute('href', /module=Roles/)
  await Promise.all([page.waitForURL(/module=Vtiger&parent=Settings&view=Index/), page.locator('#page > nav.app-fixed-navbar .module-action-content a[href*="module=Vtiger&parent=Settings&view=Index"]').first().click()])
  await waitForShell(page)
  await expect(page.locator('.settingsIndexPage')).toHaveCount(1)
  await Promise.all([page.waitForURL(/module=Accounts&view=List/), page.locator('.mu-settings-back').click()])
  // A new tab of the settings without a page of the CRM before it: the home page of the CRM.
  const context = await browser.newContext({ storageState: stateFile('admin'), viewport: { width: 1440, height: 1000 } })
  await isolateNetwork(context)
  const fresh = await context.newPage()
  await open(fresh, HOME, 'on')
  await expect(fresh.locator('.mu-settings-back')).toHaveAttribute('href', 'index.php')
  await context.close()
})

test('inner pages: the frame of the cloud with the same native actions, drag and drop and switches as v7', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = watchErrors(page)
  const nativeState = async (): Promise<Record<string, unknown>> => page.evaluate(() => {
    const visible = (node: Element): boolean => node.getClientRects().length > 0
    const label = (node: Element): string => node.id !== '' ? `#${node.id}` : node.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)
    return {
      appnav: [...document.querySelectorAll('#appnav :is(button, a[href], a[onclick])')].map(label),
      buttons: [...document.querySelectorAll('.settingsPageDiv :is(button, .btn)')].filter(visible).map(label).sort(),
      draggable: document.querySelectorAll('.settingsPageDiv .ui-draggable').length,
      sortable: document.querySelectorAll('.settingsPageDiv .ui-sortable').length,
      switches: document.querySelectorAll('.settingsPageDiv .bootstrap-switch').length,
      rows: document.querySelectorAll('.settingsPageDiv tr.listViewEntries, .settingsPageDiv tr.pickListValue, .settingsPageDiv .treeView li, .settingsPageDiv .editFields, .settingsPageDiv .modulesTable tr').length,
    }
  })
  for (const target of PAGES) {
    await open(page, target.url, 'off')
    const native = await nativeState()
    const before = errors.page.length
    await open(page, target.url, 'on')
    expect(await nativeState(), target.id).toEqual(native)
    // Frame: fixed navigation 180 px #263238 under the bar, the item of the page marked, the content next to it.
    const nav = await box(page, '#modnavigator.settingsNav')
    expect(nav.slice(0, 3), target.id).toEqual([0, 100, 180])
    expect(await page.locator('#modnavigator.settingsNav').evaluate((node) => [getComputedStyle(node).position, getComputedStyle(node).backgroundColor].join(' '))).toBe('fixed rgb(38, 50, 56)')
    await expect(page.locator('#modnavigator .settingsgroup-menu-color'), target.id).toHaveAttribute('href', new RegExp(`module=${target.module}`))
    await expect(page.locator('#modnavigator .settingsgroup-menu-color')).toBeVisible()
    expect(await page.locator('.settingsPageDiv').evaluate((node) => getComputedStyle(node).paddingLeft)).toBe('180px')
    // Every action of the bar is visible and takes its own clicks (nothing lies over it).
    for (const action of await page.locator('#appnav :is(button, a.btn)').all()) {
      if (!(await action.isVisible())) continue
      expect(await action.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return hit !== null && (hit === node || node.contains(hit))
      }), `${target.id}: action of the bar covered`).toBe(true)
    }
    expect(await sidewaysScroll(page), target.id).toBeLessThanOrEqual(1)
    expect(errors.page.slice(before).filter((message) => !errors.page.slice(0, before).includes(message)), target.id).toEqual([])
  }
})

test('dialogs: a picklist value and a custom field open in the dialog of the settings and close without saving', async ({ page }) => {
  const saves: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && (request.postData() ?? '').includes('mode=add')) {
      saves.push(request.url())
    }
  })
  await open(page, PAGES[4].url, 'on')
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mu-settings-primary').trim())
  await page.locator('#addItem').click()
  const dialog = page.locator('.modal.in .modal-content').first()
  await expect(dialog).toBeVisible()
  const header = await dialog.locator('.modal-header').first().evaluate((node) => getComputedStyle(node).backgroundColor)
  const expected = await page.evaluate((color) => { const probe = document.createElement('i'); probe.style.color = color; document.body.appendChild(probe); const value = getComputedStyle(probe).color; probe.remove(); return value }, accent || '#448aff')
  expect(header).toBe(expected)
  await expect(dialog.locator('.modal-footer :is(button[type=submit], .btn-success)').first()).toBeVisible()
  await dialog.locator('.modal-footer .cancelLink').first().click()
  await expect(page.locator('.modal.in')).toHaveCount(0)
  await open(page, PAGES[3].url, 'on')
  await page.locator('.addCustomField').first().click()
  await expect(page.locator('.modal.in .modal-content').first()).toBeVisible()
  await page.locator('.modal.in .modal-footer .cancelLink').first().click()
  await expect(page.locator('.modal.in')).toHaveCount(0)
  expect(saves).toEqual([])
})

test('languages, widths and zoom: RU/EN/DE of the theme, three, two and one column, the inner pages narrow', async ({ page }) => {
  test.setTimeout(240_000)
  await open(page, HOME, 'on')
  for (const locale of ['ru-RU', 'en-US', 'de-DE'] as const) {
    expect((await savePersonal(page, { ...personal, locale })).ok).toBe(true)
    await open(page, HOME, 'on')
    await expect(page.locator('html')).toHaveAttribute('data-mu-locale', locale)
    await expect(page.locator('.mu-settings-back')).toHaveText(dictionary(locale).back)
    await search(page, 'zzqq')
    await expect(page.locator('.mu-settings-empty__title')).toHaveText(dictionary(locale).empty)
  }
  await clearPersonal(page)
  if (Object.keys(personal).length > 0) {
    expect((await savePersonal(page, personal)).ok).toBe(true)
  }
  for (const [width, height, count] of [[1024, 900, 3], [768, 1024, 2], [412, 915, 1], [720, 500, 2]] as const) {
    await page.setViewportSize({ width, height })
    await open(page, HOME, 'on')
    expect((await columns(page)).length, `${String(width)} px`).toBe(count)
    await expect(page.locator('.mu-settings-back')).toBeInViewport()
    expect(await sidewaysScroll(page), `${String(width)} px`).toBeLessThanOrEqual(1)
    const tile = await box(page, '.settingsSummary > a')
    expect(tile[0] + tile[2], `${String(width)} px tile`).toBeLessThanOrEqual(width)
    await open(page, PAGES[0].url, 'on')
    await expect(page.locator('#page > nav.app-fixed-navbar .module-action-content h4.module-title')).toBeVisible()
    if (width < 992) {
      // As in v7 the side navigation is not shown on narrow screens; the breadcrumb leads home.
      await expect(page.locator('#modnavigator .settingsgroup')).toBeHidden()
      expect(await page.locator('.settingsPageDiv').evaluate((node) => getComputedStyle(node).paddingLeft)).not.toBe('180px')
    } else {
      await expect(page.locator('#modnavigator .settingsgroup-menu-color')).toBeVisible()
    }
  }
})

test('recovery: a failed shell, no scripts and the standard view show the settings of v7', async ({ browser, page }) => {
  const v7 = async (target: Page): Promise<void> => {
    await expect(target.locator('.settingsIndexPage > div:first-child')).toBeVisible()
    // The accordion of v7 (230 px) instead of the catalog.
    expect(await target.locator('#modnavigator .settingsgroup').evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(200)
    expect(await target.locator('.settingsgroup .panel-group').evaluate((node) => getComputedStyle(node).columnCount)).toBe('auto')
    await expect(target.locator('.mu-settings-back')).toHaveCount(0)
  }
  await page.route('**/modules/ModernUI/resources/dist/assets/shell-*.js', (route) => route.abort())
  await page.goto(withMode(HOME, 'on'))
  await expect(page.locator('html')).toHaveAttribute('data-mu-failed', /.+/, { timeout: 30_000 })
  await v7(page)
  await page.unroute('**/modules/ModernUI/resources/dist/assets/shell-*.js')
  const context = await browser.newContext({ storageState: stateFile('admin'), javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } })
  await isolateNetwork(context)
  const noScript = await context.newPage()
  await noScript.goto(withMode(HOME, 'on'))
  await expect(noScript.locator('.settingsIndexPage > div:first-child')).toBeVisible()
  expect(await noScript.locator('#modnavigator .settingsgroup').evaluate((node) => node.getBoundingClientRect().width)).toBeGreaterThan(200)
  await context.close()
  await open(page, HOME, 'off')
  await v7(page)
  await open(page, HOME, 'on')
})

test('restricted user: only the own preferences in the settings frame, the settings of the CRM stay refused', async ({ browser }) => {
  test.skip(!isClean, 'synthetic restricted user exists on the clean stand')
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const page = await context.newPage()
  await signIn(page, cleanUserCredentials('limited'))
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  await waitForShell(page)
  const me = await page.evaluate(() => {
    const id = (window as unknown as { _USERMETA?: { id?: string | number } })._USERMETA?.id
    return id === undefined ? '' : String(id)
  })
  expect(me).toMatch(/^\d+$/)
  const preferences = `index.php?module=Users&view=PreferenceDetail&parent=Settings&record=${me}`
  const items = async (): Promise<string[]> => page.locator('#modnavigator .settingsgroup a.menuItemLabel').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
  await open(page, preferences, 'off')
  const native = await items()
  await open(page, preferences, 'on')
  expect(await items()).toEqual(native)
  expect(native.some((href) => /module=(?:Roles|Profiles|Workflows|ModuleManager|LayoutEditor)\b/.test(href))).toBe(false)
  await expect(page.locator('.mu-settings-back')).toBeVisible()
  await expect(page.locator('#modnavigator #settingsMenuSearch')).toHaveCount(0)
  for (const theme of ['off', 'on'] as const) {
    await page.goto(withMode(HOME, theme))
    await expect(page.locator('.settingsIndexPage')).toHaveCount(0)
    await expect(page.locator('.settingsgroup a.menuItemLabel[href*="module=Roles"]')).toHaveCount(0)
  }
  await context.close()
})

test.describe('clean stand: real changes through the native settings with the theme on', () => {
  test.skip(!isClean, 'the dev instance keeps its roles, profiles, fields, picklists and workflows')
  test.setTimeout(300_000)
  const stamp = Date.now().toString(36)
  const ROLE = `MU15 Role ${stamp}`
  const USER = `mu15.${stamp}`
  const FIELD = `MU15 Field ${stamp}`
  const VALUE = `MU15 Value ${stamp}`
  const WORKFLOW = `MU15 Workflow ${stamp}`
  let roleId = ''
  let userId = ''

  /** Sets a value of a native select that Select2 decorates and lets its handlers know. */
  async function choose(page: Page, selector: string, value: string): Promise<void> {
    await page.locator(selector).evaluate((node, chosen) => {
      const select = node as HTMLSelectElement
      for (const option of select.options) {
        option.selected = option.value === chosen
      }
      const jq = (window as unknown as { jQuery?: (element: Element) => { trigger(name: string): void } }).jQuery
      if (jq !== undefined) {
        jq(select).trigger('change')
      } else {
        select.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, value)
  }

  test('role: create under the CEO with an existing profile, rename it', async ({ page }) => {
    await open(page, PAGES[1].url, 'on')
    const parent = page.locator('.treeView li[data-roleid="H2"] > .toolbar-handle')
    await parent.hover()
    // The 10 px icons of the node toolbar of v7 fail the pointer hit test of Playwright in v7 itself (modernui=off): the
    // link is clicked as a link.
    await Promise.all([page.waitForURL(/view=Edit&parent_roleid=H2/), parent.locator('.toolbar a[href*="parent_roleid=H2"]').evaluate((link) => { (link as HTMLElement).click() })])
    await waitForShell(page)
    await expect(page.locator('#modnavigator .settingsgroup-menu-color')).toHaveAttribute('href', /module=Roles/)
    await page.locator('form#EditView [name="rolename"]').fill(ROLE)
    await page.locator('form#EditView [name="profile_directly_related_to_role"][value="0"]').check()
    const profile = await page.locator('form#EditView select[name="profiles[]"] option').first().getAttribute('value')
    await choose(page, 'form#EditView select[name="profiles[]"]', profile ?? '')
    await Promise.all([page.waitForURL(/module=Roles&parent=Settings&view=Index/), page.locator('form#EditView .saveButton').click()])
    await waitForShell(page)
    const node = page.locator('.treeView .toolbar-handle > a.btn', { hasText: ROLE })
    await expect(node).toBeVisible()
    roleId = await node.evaluate((link) => link.closest('li')?.getAttribute('data-roleid') ?? '')
    expect(roleId).toMatch(/^H\d+$/)
    await Promise.all([page.waitForURL(new RegExp(`record=${roleId}`)), node.click()])
    await page.locator('form#EditView [name="rolename"]').fill(`${ROLE} Ä`)
    await Promise.all([page.waitForURL(/module=Roles&parent=Settings&view=Index/), page.locator('form#EditView .saveButton').click()])
    await waitForShell(page)
    await expect(page.locator(`.treeView li[data-roleid="${roleId}"] > .toolbar-handle > a.btn`)).toHaveText(`${ROLE} Ä`)
  })

  test('user: create with the new role, change the title, the list shows the role', async ({ page }) => {
    expect(roleId).not.toBe('')
    await open(page, PAGES[0].url, 'on')
    await Promise.all([page.waitForURL(/module=Users&parent=Settings&view=Edit/), page.locator('#Users_listView_basicAction_LBL_ADD_RECORD').click()])
    await waitForShell(page)
    const form = page.locator('form#EditView')
    await form.locator('[name="user_name"]').fill(USER)
    await form.locator('[name="email1"]').fill(`${USER}@clean.example.test`)
    await form.locator('[name="last_name"]').fill('MU15 User')
    await form.locator('[name="user_password"]').fill('Mu15-Password-1!')
    await form.locator('[name="confirm_password"]').fill('Mu15-Password-1!')
    await choose(page, 'form#EditView select[name="roleid"]', roleId)
    await Promise.all([page.waitForURL(/module=Users.*view=Detail.*record=\d+/), form.locator('button[type="submit"].saveButton, .saveButton').first().click()])
    userId = new URL(page.url()).searchParams.get('record') ?? ''
    expect(userId).toMatch(/^\d+$/)
    await page.goto(withMode(`index.php?module=Users&parent=Settings&view=Edit&record=${userId}`, 'on'))
    await waitForShell(page)
    await page.locator('form#EditView [name="title"]').fill('MU15 Title')
    await Promise.all([page.waitForURL(/view=Detail/), page.locator('form#EditView .saveButton').first().click()])
    await expect(page.locator('body')).toContainText('MU15 Title')
    await open(page, PAGES[0].url, 'on')
    await expect(page.locator(`tr.listViewEntries[data-id="${userId}"]`)).toContainText(`${ROLE} Ä`)
  })

  test('field: add a custom text field to organizations, change its default, it takes effect in the form', async ({ page }) => {
    await open(page, PAGES[3].url, 'on')
    await page.locator('.addCustomField').first().click()
    const dialog = page.locator('.modal.in')
    await expect(dialog.locator('[name="fieldLabel"]')).toBeVisible()
    await dialog.locator('[name="fieldLabel"]').fill(FIELD)
    await dialog.locator('[name="fieldLength"]').fill('60')
    await dialog.locator('[name="saveButton"]').click()
    await expect(page.locator('.modal.in')).toHaveCount(0)
    const field = page.locator('.editFields', { hasText: FIELD })
    await expect(field).toBeVisible()
    const name = await field.getAttribute('data-field-name') ?? ''
    expect(name).toMatch(/^cf_\d+$/)
    await field.locator('xpath=ancestor::li[1]').locator('.editFieldDetails').click()
    await expect(page.locator('.modal.in [name="fieldDefaultValue"]')).toBeVisible()
    await page.locator('.modal.in [name="fieldDefaultValue"]').fill('MU15 default')
    await page.locator('.modal.in [name="saveButton"]').click()
    await expect(page.locator('.modal.in')).toHaveCount(0)
    await page.goto(withMode('index.php?module=Accounts&view=Edit', 'off'))
    await expect(page.locator(`form#EditView [name="${name}"]`)).toHaveValue('MU15 default')
    // Delete the field again through the editor.
    await open(page, PAGES[3].url, 'on')
    const item = page.locator('.editFields', { hasText: FIELD }).locator('xpath=ancestor::li[1]')
    await item.hover()
    await item.locator('.deleteCustomField').click()
    await page.locator('.bootbox .btn-primary, .bootbox [data-bb-handler="confirm"]').first().click()
    await expect(page.locator('.editFields', { hasText: FIELD })).toHaveCount(0)
    await page.goto(withMode('index.php?module=Accounts&view=Edit', 'off'))
    await expect(page.locator(`form#EditView [name="${name}"]`)).toHaveCount(0)
  })

  test('picklist value: add, rename, it is offered in the form, delete with a replacement', async ({ page }) => {
    await open(page, PAGES[4].url, 'on')
    await page.locator('#addItem').click()
    const dialog = page.locator('.modal.in').last()
    await expect(dialog.locator('.modal-footer')).toBeVisible()
    await page.waitForTimeout(600) // the fade of the Bootstrap dialog
    await dialog.locator('.select2-container').first().click()
    await page.keyboard.type(VALUE)
    await page.keyboard.press('Enter')
    await expect(dialog.locator('[name="newValue"]')).toHaveValue(VALUE)
    // The open Select2 drop has a mask over the page: the first click only closes it (as for a user).
    if (await page.locator('#select2-drop-mask').isVisible()) {
      await page.locator('#select2-drop-mask').click()
    }
    await dialog.locator('[name="saveButton"]').click()
    await expect(page.locator(`tr.pickListValue[data-key="${VALUE}"]`)).toBeVisible()
    const row = page.locator(`tr.pickListValue[data-key="${VALUE}"]`)
    await row.hover()
    await row.locator('.renameItem').click()
    const renamed = page.locator('.modal.in [name="renamedValue"]')
    await expect(renamed).toBeVisible()
    await renamed.fill(`${VALUE} Ä`)
    await page.locator('.modal.in [name="saveButton"], .modal.in button[type="submit"]').first().click()
    await expect(page.locator(`tr.pickListValue[data-key="${VALUE} Ä"]`)).toBeVisible()
    await page.goto(withMode('index.php?module=Accounts&view=Edit', 'off'))
    await expect(page.locator(`form#EditView select[name="industry"] option[value="${VALUE} Ä"]`)).toHaveCount(1)
    await open(page, PAGES[4].url, 'on')
    const changed = page.locator(`tr.pickListValue[data-key="${VALUE} Ä"]`)
    await changed.hover()
    await changed.locator('.deleteItem').click()
    await expect(page.locator('.modal.in')).toBeVisible()
    await page.locator('.modal.in [name="saveButton"], .modal.in button[type="submit"]').first().click()
    await expect(page.locator(`tr.pickListValue[data-key="${VALUE} Ä"]`)).toHaveCount(0)
  })

  test('workflow: a simple workflow without tasks, switched off, deleted', async ({ page }) => {
    await open(page, PAGES[5].url, 'on')
    await Promise.all([page.waitForURL(/module=Workflows&parent=Settings&view=Edit/), page.locator('#Workflows_listView_basicAction_LBL_ADD_RECORD').click()])
    await waitForShell(page)
    await page.locator('[name="workflowname"]').fill(WORKFLOW)
    await choose(page, 'select[name="module_name"]', 'Accounts')
    await page.locator('[name="workflow_trigger"][value="1"]').check()
    const editor = page.url()
    await Promise.all([page.waitForURL((url) => url.href !== editor), page.locator('.settingsPageDiv button[type="submit"].saveButton, .settingsPageDiv .saveButton').last().click()])
    await page.waitForLoadState('load')
    await open(page, `${PAGES[5].url}&sourceModule=Accounts`, 'on')
    const row = page.locator('tr.listViewEntries', { hasText: WORKFLOW })
    await expect(row).toBeVisible()
    await row.locator('.bootstrap-switch').click()
    await expect(row.locator('.bootstrap-switch')).toHaveClass(/bootstrap-switch-off/)
    await open(page, `${PAGES[5].url}&sourceModule=Accounts`, 'on')
    const again = page.locator('tr.listViewEntries', { hasText: WORKFLOW })
    await expect(again.locator('.bootstrap-switch')).toHaveClass(/bootstrap-switch-off/)
    await again.hover()
    await again.locator('.deleteRecordButton').click()
    await page.locator('.bootbox [data-bb-handler="confirm"]').click()
    await expect(page.locator('tr.listViewEntries', { hasText: WORKFLOW })).toHaveCount(0)
  })

  test('cleanup: the user is deleted permanently and the role with a transfer, through the same screens', async ({ page }) => {
    expect(userId).not.toBe('')
    await cleanup(page)
    await open(page, PAGES[0].url, 'on')
    await expect(page.locator(`tr.listViewEntries[data-id="${userId}"]`)).toHaveCount(0)
    await open(page, PAGES[1].url, 'on')
    await expect(page.locator(`.treeView li[data-roleid="${roleId}"]`)).toHaveCount(0)
  })

  test.afterAll(async ({ browser }) => {
    // After a failed step the objects of the scenario (and of an interrupted earlier run) still go, by their MU15 names.
    const page = await browser.newPage()
    try {
      await cleanup(page)
    } finally {
      await page.close()
    }
  })

  /** Deletes every synthetic MU15 user (permanently, records to the administrator), MU15 role (to the CEO) and MU15 value. */
  async function cleanup(page: Page): Promise<void> {
    await open(page, PAGES[0].url, 'on')
    for (;;) {
      const row = page.locator('tr.listViewEntries').filter({ hasText: /mu15\.[a-z0-9]+@clean\.example\.test/ }).first()
      if (await row.count() === 0) break
      const id = await row.getAttribute('data-id')
      await row.locator('.dropdown-toggle').click()
      await row.locator('.dropdown-menu a').filter({ hasText: /^(?:Delete|Удалить|Löschen)$/ }).click()
      await page.locator('.bootbox [data-bb-handler="confirm"]').click()
      const form = page.locator('form#deleteUser')
      await expect(form).toBeVisible()
      await expect(form.locator('[name="userid"]')).toHaveValue(id ?? '')
      await form.locator('[name="deleteUserPermanent"]').check()
      await form.locator('button[type="submit"]').click()
      await expect(page.locator(`tr.listViewEntries[data-id="${id ?? ''}"]`)).toHaveCount(0)
      await open(page, PAGES[0].url, 'on')
    }
    await open(page, PAGES[1].url, 'on')
    for (;;) {
      const node = page.locator('.treeView li').filter({ has: page.locator(':scope > .toolbar-handle > a.btn', { hasText: /^MU15 Role / }) }).last()
      if (await node.count() === 0) break
      const id = await node.getAttribute('data-roleid')
      await node.locator(':scope > .toolbar-handle').hover()
      await node.locator(':scope > .toolbar-handle .toolbar a[data-action="modal"]').evaluate((link) => { (link as HTMLElement).click() })
      await expect(page.locator('#roleDeleteForm')).toBeVisible()
      await page.locator('#roleDeleteForm .relatedPopup').click()
      await page.locator('.roleEle', { hasText: /^CEO$/ }).first().click()
      await expect(page.locator('#roleDeleteForm [name="transfer_record"]')).toHaveValue('H2')
      await page.locator('#roleDeleteForm [name="saveButton"]').click()
      await expect(page.locator(`.treeView li[data-roleid="${id ?? ''}"]`)).toHaveCount(0)
      await open(page, PAGES[1].url, 'on')
    }
    await open(page, PAGES[4].url, 'on')
    for (;;) {
      const value = page.locator('tr.pickListValue[data-key^="MU15 "]').first()
      if (await value.count() === 0) break
      const key = await value.getAttribute('data-key')
      await value.hover()
      await value.locator('.deleteItem').click()
      await expect(page.locator('.modal.in')).toBeVisible()
      await page.locator('.modal.in [name="saveButton"], .modal.in button[type="submit"]').first().click()
      await expect(page.locator(`tr.pickListValue[data-key="${key ?? ''}"]`)).toHaveCount(0)
    }
  }
})
