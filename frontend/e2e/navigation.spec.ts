/**
 * Stage 06 — navigation shell and working lists, as an administrator, on the dev instance and the clean stand (project
 * "navigation"):
 *
 * - the mega menu replaces the v7 app menu: every v7 entry stays reachable (the theme menu or "More"), plain links
 *   (new tab, back/forward, reload, direct link, the base path of the CRM), keyboard, search, Esc and focus;
 * - an entry an extension adds to the v7 app menu: a link appears under "More", a button without a link brings the v7
 *   hamburger back;
 * - the favorites bar: space reserved from the first paint (no layout shift while the shell loads), add and remove the
 *   module of the page, compact state, favorites switched off by the administrator;
 * - the mega menu follows the menu settings (order, hidden modules); a hidden module still opens;
 * - stage 11, the header of the cloud: one main row (menu, title, search, actions, logo, user) and the toolbar of the page
 *   instead of the two rows of v7, no permanent module rail on working screens (record and form pages too), the views of
 *   the calendar in the context navigation, the settings menu kept; search, quick create, the user menu and icons or
 *   buttons extensions add later stay usable; the v7 header back in the standard view, after a failed shell and without
 *   scripts;
 * - lists: filter → sort → select rows → action → back to the list; search → record → back; empty list; the loading
 *   indicator; AJAX re-renders keep check boxes and menus working with the same number of requests and handlers as
 *   without the theme; the popup to select a record;
 * - texts and accessibility labels of the navigation in RU/EN/DE, long German labels, narrow screens.
 *
 * The dev instance gets no record of the CRM: list actions there are read-only (export dialog closed without exporting);
 * the clean stand also marks and unmarks synthetic records with a star. Theme settings and personal settings of the
 * administrator are written back at the end.
 */
import { expect, test, type Browser, type Page, type Request } from '@playwright/test'
import { crmUrl, isClean, stateFile } from './env'
import { HOME, SETTINGS_FORMS, isolateNetwork, openListFilters, openListSearch, waitForShell } from './support'
import { bootstrap, clearPersonal, globalScope, patchGlobal, saveGlobal, savePersonal, type Scope } from './settings-api'

test.describe.configure({ mode: 'serial' })

const LIST = 'index.php?module=Accounts&view=List&app=MARKETING'
const TRIGGER = '[data-mu-trigger="mega-menu"]'
const PANEL = '[data-mu-panel="mega-menu"]'

/** Texts of the navigation in the language of the theme (the CRM language: ru_ru on the dev instance, en_us on the clean stand). */
const TEXT: Record<string, { open: string; add: string }> = {
  'ru-RU': { open: 'Открыть меню', add: 'в избранное' },
  'en-US': { open: 'Open the menu', add: 'to favorites' },
  'de-DE': { open: 'Menü öffnen', add: 'zu den Favoriten' },
}

async function text(page: Page): Promise<{ open: string; add: string }> {
  const locale = ((await bootstrap(page))['locale'] as { effective: string }).effective
  const found = TEXT[locale]
  expect(found, locale).toBeDefined()
  return found ?? { open: '', add: '' }
}

let original: Scope
let originalPersonal: Record<string, unknown> = {}

interface BootMenu {
  groups: { id: string; label: string; app: string | null; items: { id: string; module: string; label: string; url: string }[] }[]
  system: { id: string; url?: string }[]
  modules: string[]
}

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: stateFile('admin') })
  await isolateNetwork(context)
  return context.newPage()
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForShell(page)
  await expect(page.locator('html')).toHaveClass(/mu-shell-ready/)
}

async function menuOf(page: Page): Promise<BootMenu> {
  return (await bootstrap(page))['menu'] as BootMenu
}

/** CRM links of the v7 app menu (href and data-default-url), as module/view/parent. */
async function v7AppMenu(page: Page): Promise<{ module: string; parent: string; url: string }[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll('#app-menu a[href], #app-menu [data-default-url]'))
    .map((element) => element.getAttribute('href') ?? element.getAttribute('data-default-url') ?? '')
    .filter((raw) => raw !== '' && raw !== '#' && !raw.startsWith('javascript'))
    .map((raw) => {
      const url = new URL(raw, document.baseURI)
      return { module: url.searchParams.get('module') ?? '', parent: url.searchParams.get('parent') ?? '', url: `index.php${url.search}` }
    }))
}

/** XHR/fetch requests of the CRM made by an action, until the network is quiet. */
async function requestsDuring(page: Page, action: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const listener = (request: Request): void => {
    if (['xhr', 'fetch'].includes(request.resourceType()) && request.url().includes('index.php')) {
      const params = new URLSearchParams(`${new URL(request.url()).search.slice(1)}&${request.postData() ?? ''}`)
      seen.push(`${params.get('module') ?? ''}/${params.get('view') ?? params.get('action') ?? ''}/${params.get('mode') ?? ''}`)
    }
  }
  page.on('request', listener)
  await action()
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(300)
  page.off('request', listener)
  return seen.sort()
}

/** Delegated jQuery handlers of the list and of the document (proof of no duplicated handlers after re-renders). */
async function handlerCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const jq = (window as unknown as { jQuery: { _data: (element: unknown, name: string) => Record<string, { namespace?: string }[]> | undefined } }).jQuery
    // The optional Conditional Layouts bridge owns one documented AJAX listener. Count native handlers separately;
    // the bridge count is asserted below, so a duplicated subscription still fails this scenario.
    const count = (element: unknown): number => Object.values(jq._data(element, 'events') ?? {})
      .reduce((sum, list) => sum + list.filter((handler) => handler.namespace !== 'modernuiConditionalLayouts').length, 0)
    return { document: count(document), list: count(document.getElementById('listViewContent')), body: count(document.body) }
  })
}

async function waitForList(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#messageBar')).toHaveClass(/hide/)
}

test.beforeAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto(SETTINGS_FORMS)
  if ((await page.locator('button[name="modernui-enable-for-me"]').count()) > 0) {
    await Promise.all([page.waitForURL(/result=/), page.locator('button[name="modernui-enable-for-me"]').click()])
  }
  original = await globalScope(page)
  originalPersonal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  await clearPersonal(page)
  await page.context().close()
})

test.afterAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto(`${SETTINGS_FORMS}&modernui=on`)
  const current = await globalScope(page)
  expect((await saveGlobal(page, original.values, current.revision)).ok).toBe(true)
  await clearPersonal(page)
  if (Object.keys(originalPersonal).length > 0) {
    expect((await savePersonal(page, originalPersonal)).ok).toBe(true)
  }
  await page.context().close()
})

test.beforeEach(async ({ context, page }) => {
  await isolateNetwork(context)
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
})

test('mega menu replaces the v7 app menu: every v7 entry stays reachable, plain links, keyboard, search, Esc', async ({ page, context }) => {
  await open(page, LIST)
  await expect(page.locator('html')).toHaveAttribute('data-mu-replaced', /app-menu/)
  await expect(page.locator('#appnavigator')).toBeHidden()
  const trigger = page.locator(TRIGGER)
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-label', (await text(page)).open)

  const menu = await menuOf(page)
  const v7 = await v7AppMenu(page)
  expect(v7.length).toBeGreaterThan(3)
  await trigger.click()
  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-mu-field="menu-search"]')).toBeFocused()
  // Links the theme menu does not cover: "More" of the configuration column, the extension store of the core in the footer.
  const extras = await panel.locator('[data-mu-item="extra"], [data-mu-item="store"]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
  const system = new Set(menu.system.map((item) => item.url ?? ''))
  // Every v7 entry: a module the theme menu covers (also hidden ones), a settings entry of the system section, or "More".
  for (const entry of v7) {
    const covered = menu.modules.includes(entry.module)
      || (entry.parent === 'Settings' && [...system].some((url) => url.includes(`module=${entry.module}&parent=Settings`)))
      || extras.includes(entry.url)
    expect(covered, `v7 entry ${entry.url}`).toBe(true)
  }

  // Sections: one tab per group, the section of the page open, arrows move, the panel follows.
  const tabs = panel.locator('[role="tab"]')
  await expect(tabs).toHaveCount(menu.groups.length)
  await expect(panel.locator('[role="tab"][aria-selected="true"]')).toHaveAttribute('data-mu-group', 'marketing')
  await expect(panel.locator('#mu-mega-panel [aria-current="page"]')).toHaveAttribute('data-mu-item', 'm:Accounts')
  await panel.locator('[role="tab"][aria-selected="true"]').focus()
  await page.keyboard.press('ArrowDown')
  const second = menu.groups[1]
  if (second !== undefined) {
    await expect(panel.locator(`[role="tab"][data-mu-group="${second.id}"]`)).toBeFocused()
    await expect(panel.locator('#mu-mega-panel')).toContainText(second.items[0]?.label ?? '')
  }
  await page.keyboard.press('ArrowRight')
  await expect(panel.locator('#mu-mega-panel a[href]').first()).toBeFocused()

  // Every entry is a link of this CRM (base path included): opening it in a new tab is the browser's own behaviour.
  for (const href of await panel.locator('a[href]').evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))) {
    expect(href.startsWith(`${crmUrl()}index.php?`), href).toBe(true)
  }
  const firstLink = panel.locator('#mu-mega-panel a[href]').first()
  const expected = await firstLink.evaluate((link) => (link as HTMLAnchorElement).href)
  const [tab] = await Promise.all([context.waitForEvent('page'), firstLink.click({ modifiers: ['ControlOrMeta'] })])
  await tab.waitForURL(expected)
  await tab.close()
  expect(page.url()).toBe(`${crmUrl()}${LIST}`)

  // Search: ё/ß-insensitive, Enter opens the first result.
  const search = panel.locator('[data-mu-field="menu-search"]')
  const preferences = await panel.locator('[data-mu-item="preferences"]').innerText()
  await search.fill('zzz-no-module')
  await expect(panel.locator('.mu-mega__no-results [role="status"]')).toContainText('zzz-no-module')
  const empty = await panel.locator('.mu-mega__no-results > p').boundingBox()
  expect(empty).not.toBeNull()
  expect(Math.abs((empty?.x ?? 0) + (empty?.width ?? 0) / 2 - 428.5)).toBeLessThanOrEqual(4)
  const expectedY = 595 + ((page.viewportSize()?.height ?? 1000) - 1000) / 2
  expect(Math.abs((empty?.y ?? 0) - expectedY)).toBeLessThanOrEqual(4)
  await expect(panel.locator('.mu-mega__groups')).toBeHidden()
  // A configuration-only result must keep its link, even if no module matches.
  await search.fill(preferences)
  await expect(panel.locator('.mu-mega__no-results')).toBeHidden()
  await expect(panel.locator('.mu-mega__service [data-mu-item="preferences"]')).toBeVisible()
  const target = menu.groups.flatMap((group) => group.items).find((item) => item.module === 'Contacts')
  expect(target).toBeDefined()
  await search.fill((target?.label ?? '').slice(0, 4))
  await expect(panel.locator(`#mu-mega-panel [data-mu-item="m:Contacts"]`).first()).toBeVisible()
  await search.fill('')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()

  // A click outside closes it too.
  await trigger.click()
  await expect(panel).toBeVisible()
  // Reka listens for a pointer outside from the next task after opening (the opening click must not close it).
  await page.waitForTimeout(200)
  await page.mouse.click(1400, 600)
  await expect(panel).toBeHidden()
})

test('navigation keeps the browser model: back/forward, reload, direct link; no router, no extra requests', async ({ page }) => {
  await open(page, HOME)
  const menu = await menuOf(page)
  const contacts = menu.groups.flatMap((group) => group.items).find((item) => item.module === 'Contacts')
  expect(contacts).toBeDefined()
  await page.locator(TRIGGER).click()
  await page.locator(PANEL).locator('[data-mu-field="menu-search"]').fill(contacts?.label ?? '')
  await Promise.all([page.waitForURL(/module=Contacts/), page.locator(`${PANEL} #mu-mega-panel [data-mu-item="m:Contacts"]`).first().click()])
  await waitForShell(page)
  expect(page.url()).toBe(`${crmUrl()}${contacts?.url ?? ''}`)
  await page.goBack()
  await waitForShell(page)
  expect(page.url()).toBe(`${crmUrl()}${HOME}`)
  await expect(page.locator(PANEL)).toHaveCount(0)
  await page.goForward()
  await waitForShell(page)
  expect(page.url()).toContain('module=Contacts')
  await page.reload()
  await waitForShell(page)
  await page.locator(TRIGGER).click()
  await expect(page.locator(`${PANEL} #mu-mega-panel [aria-current="page"]`)).toHaveAttribute('data-mu-item', 'm:Contacts')
  await page.keyboard.press('Escape')
  // A direct link with the app of another section opens the menu on that section.
  await open(page, 'index.php?module=Contacts&view=List&app=SALES')
  const sales = menu.groups.find((group) => group.app === 'SALES' && group.items.some((item) => item.module === 'Contacts'))
  if (sales !== undefined) {
    await page.locator(TRIGGER).click()
    await expect(page.locator(`${PANEL} [role="tab"][aria-selected="true"]`)).toHaveAttribute('data-mu-group', sales.id)
    await page.keyboard.press('Escape')
  }
})

test('extensions in the v7 app menu: a link appears under "More", a button without a link brings the v7 hamburger back', async ({ page }) => {
  await open(page, LIST)
  await page.evaluate(() => {
    const list = document.querySelector('#app-menu .app-list')
    const link = document.createElement('div')
    link.className = 'menu-item app-item app-item-misc mu-test-extension'
    link.setAttribute('data-default-url', 'index.php?module=MuTestExtension&view=Board')
    const label = document.createElement('span')
    label.className = 'app-name'
    label.textContent = ' Erweiterung „Größe“ '
    link.appendChild(label)
    list?.appendChild(link)
  })
  await page.locator(TRIGGER).click()
  await expect(page.locator(`${PANEL} [data-mu-item="extra"][href="index.php?module=MuTestExtension&view=Board"]`)).toHaveText('Erweiterung „Größe“')
  await page.keyboard.press('Escape')

  await page.evaluate(() => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mu-test-launcher'
    document.querySelector('#app-menu .app-list')?.appendChild(button)
  })
  await expect(page.locator('#appnavigator')).toBeVisible()
  await expect(page.locator(TRIGGER)).toBeVisible()
  await page.evaluate(() => document.querySelector('#app-menu .mu-test-launcher')?.remove())
  await expect(page.locator('#appnavigator')).toBeHidden()
})

test('favorites bar: reserved from the first paint, add and remove the module of the page, compact, switched off', async ({ page }) => {
  // The shell is held back: the bar space is already there, nothing moves when it mounts.
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/dist\/assets\/shell-[^/]+\.js$/, async (route) => {
    await held
    await route.continue()
  })
  await page.goto(LIST, { waitUntil: 'domcontentloaded' })
  // The logo and the fonts change the header by themselves: measure once they are there, then let the shell in.
  await page.waitForFunction(() => document.fonts.status === 'loaded'
    && Array.from(document.querySelectorAll('nav.app-fixed-navbar img')).every((image) => (image as HTMLImageElement).complete))
  await page.evaluate(() => {
    const store = window as unknown as { muShifts: number }
    store.muShifts = 0
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.muShifts += (entry as unknown as { value: number }).value
      }
    }).observe({ type: 'layout-shift' })
  })
  // Favorites bar 42 px, the main row of the cloud over its last 2 px (40 + 56), the toolbar under it.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#page > nav.app-fixed-navbar') ?? document.body).paddingTop)).toBe('40px')
  const before = await page.evaluate(() => ({
    nav: document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().height ?? 0,
    main: document.querySelector('.main-container')?.getBoundingClientRect().top ?? 0,
    title: document.querySelector('#page > nav.app-fixed-navbar .module-title')?.getBoundingClientRect().top ?? 0,
    search: document.querySelector('#page > nav.app-fixed-navbar .search-link')?.getBoundingClientRect().left ?? 0,
  }))
  expect(before.nav).toBe(96)
  expect(before.main).toBe(96 + 52)
  release()
  await waitForShell(page)
  await page.unroute(/\/dist\/assets\/shell-[^/]+\.js$/)
  const after = await page.evaluate(() => ({
    nav: document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().height ?? 0,
    main: document.querySelector('.main-container')?.getBoundingClientRect().top ?? 0,
    bar: document.querySelector('.mu-favbar')?.getBoundingClientRect().height ?? 0,
    title: document.querySelector('#page > nav.app-fixed-navbar .module-title')?.getBoundingClientRect().top ?? 0,
    search: document.querySelector('#page > nav.app-fixed-navbar .search-link')?.getBoundingClientRect().left ?? 0,
  }))
  expect(after.nav).toBe(before.nav)
  expect(after.main).toBe(before.main)
  expect(after.bar).toBe(42)
  // The islands of the row (menu button, system menu) take places the stylesheet kept for them.
  expect(after.title).toBe(before.title)
  expect(after.search).toBe(before.search)
  expect(await page.evaluate(() => (window as unknown as { muShifts: number }).muShifts)).toBeLessThan(0.01)
  await expect(page.locator('.mu-favbar__empty')).toBeVisible()

  // Add the module of the page with the star, it is a tab of the bar and stays after a reload.
  await page.locator('[data-mu-trigger="favorites"]').click()
  await expect(page.locator('[data-mu-item="favorite-toggle"]')).toContainText((await text(page)).add)
  await page.locator('[data-mu-item="favorite-toggle"]').click()
  const tab = page.locator('.mu-favbar__tab[data-mu-item="m:Accounts"]')
  await expect(tab).toHaveAttribute('aria-current', 'page')
  await page.reload()
  await waitForShell(page)
  await expect(tab).toBeVisible()
  expect(((await menuOf(page)) as unknown as { favorites: { id: string }[] }).favorites.map((item) => item.id)).toEqual(['m:Accounts'])
  // Mega menu: favorites are the first section.
  await page.locator(TRIGGER).click()
  await expect(page.locator(`${PANEL} [role="tab"]`).first()).toHaveAttribute('data-mu-group', '__favorites')
  await page.keyboard.press('Escape')

  // Compact: icons only, the label in aria-label and title.
  expect((await savePersonal(page, { 'navigation.favorites': ['Accounts', 'Contacts'], 'navigation.compact': true })).ok).toBe(true)
  await page.reload()
  await waitForShell(page)
  await expect(page.locator('.mu-favbar--compact .mu-favbar__tab')).toHaveCount(2)
  await expect(page.locator('.mu-favbar__tab').nth(1)).toHaveAttribute('aria-label', /.+/)
  await expect(page.locator('.mu-favbar__text')).toHaveCount(0)

  // Remove it again with the star.
  await page.locator('[data-mu-trigger="favorites"]').click()
  await page.locator('[data-mu-item="favorite-toggle"]').click()
  await expect(page.locator('.mu-favbar__tab[data-mu-item="m:Accounts"]')).toHaveCount(0)

  // Switched off by the administrator: no bar and no reserved space.
  await patchGlobal(page, { 'navigation.favoritesEnabled': false })
  await page.reload()
  await waitForShell(page)
  await expect(page.locator('.mu-favbar')).toHaveCount(0)
  const off = await page.evaluate(() => ({
    nav: document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().bottom ?? 0,
    main: document.querySelector('.main-container')?.getBoundingClientRect().top ?? 0,
  }))
  expect(off.main).toBe(before.main - 40)
  // The header covers the page no more than the v7 header does without the theme (the stock 8.4 header is a few
  // pixels taller than the padding of #page by itself).
  await page.goto(`${LIST}&modernui=off`)
  const v7 = await page.evaluate(() => ({
    nav: document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().bottom ?? 0,
    main: document.querySelector('.main-container')?.getBoundingClientRect().top ?? 0,
  }))
  await page.goto(`${LIST}&modernui=on`)
  await waitForShell(page)
  expect(off.nav - off.main).toBeLessThanOrEqual(Math.max(0, v7.nav - v7.main) + 1)
  await patchGlobal(page, { 'navigation.favoritesEnabled': null })
  await clearPersonal(page)
})

test('no permanent module rail; the mega menu follows the menu settings: order, labels, hidden modules; a hidden module still opens', async ({ page }) => {
  await open(page, 'index.php?module=Contacts&view=List&app=MARKETING')
  // The v7 strip is gone with its space (its modules are in the mega menu), not replaced by another rail.
  await expect(page.locator('#modnavigator')).toBeHidden()
  await expect(page.locator('[data-mu-root="module-rail"], .mu-rail')).toHaveCount(0)
  expect(await page.evaluate(() => document.querySelector('.sidebar-essentials')?.getBoundingClientRect().left ?? 0)).toBe(0)
  const menu = await menuOf(page)
  const group = menu.groups.find((entry) => entry.app === 'MARKETING' && entry.items.some((item) => item.module === 'Contacts'))
  expect(group).toBeDefined()
  await page.locator(TRIGGER).click()
  expect(await page.locator(`${PANEL} #mu-mega-panel a[data-mu-item]`).evaluateAll((links) => links.map((link) => link.getAttribute('data-mu-item'))))
    .toEqual(group?.items.map((item) => item.id))
  await page.keyboard.press('Escape')

  // A group of our own with a long German label, Contacts first; Accounts hidden.
  const german = 'Kundenbeziehungsmanagementübersicht'
  await patchGlobal(page, {
    'navigation.groups': [
      { id: 'kunden', label: { 'de-DE': german, 'ru-RU': 'Клиенты и контрагенты', '*': 'Customers' }, icon: 'users', collapsed: false, items: ['Contacts', 'Accounts', 'Leads', 'NoSuchModuleOfModernUI'].map((module) => ({ type: 'module', module, label: null, icon: null })) },
    ],
    'navigation.hidden': ['Accounts'],
  })
  expect((await savePersonal(page, { locale: 'de-DE' })).ok).toBe(true)
  await open(page, 'index.php?module=Contacts&view=List&app=MARKETING')
  await page.locator(TRIGGER).click()
  const panel = page.locator(PANEL)
  await expect(panel.locator('[role="tab"][aria-selected="true"]')).toHaveAttribute('data-mu-group', 'kunden')
  const entries = await panel.locator('#mu-mega-panel a[data-mu-item]').evaluateAll((links) => links.map((link) => link.getAttribute('data-mu-item')))
  expect(entries[0]).toBe('m:Contacts')
  expect(entries).not.toContain('m:Accounts')
  await expect(panel.locator('[role="tab"]').first()).toHaveAttribute('title', german)
  // The long label stays inside the 86 px column of the apps (two lines at most, the full text in title).
  const overflow = await panel.locator('[role="tab"]').first().evaluate((tab) => tab.scrollWidth - tab.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-label', 'Menü öffnen')
  await expect(panel.locator('.mu-mega__modules .mu-mega__heading')).toHaveText('Module')
  await expect(panel.locator('.mu-mega__heading--service')).toHaveText('Konfiguration')
  await expect(panel.locator('.mu-mega__subhead--service').first()).toHaveText('Service und Einstellungen')
  await page.keyboard.press('Escape')
  // The hidden module opens by its direct link as before.
  const response = await page.goto(LIST)
  expect(response?.status()).toBe(200)
  await waitForShell(page)
  await expect(page.locator('#listview-table, .listview-table').first()).toBeAttached()
  await patchGlobal(page, { 'navigation.groups': null, 'navigation.hidden': null })
  await clearPersonal(page)
})

test('lists: filter → sort → select rows → action → back to the list, with the same requests and handlers as v7', async ({ page }) => {
  // Requests and handlers of v7 alone (safe mode for this session), then the same steps with the theme.
  const steps = async (): Promise<{ filter: string[]; sort: string[]; check: string[]; handlers: Record<string, number> }> => {
    await page.waitForSelector('#listview-table tr.listViewEntries')
    const otherFilter = page.locator('.lists-menu > li.listViewFilter:not(.active) a.filterName').first()
    const filter = await requestsDuring(page, async () => {
      await openListFilters(page)
      await otherFilter.click()
    })
    await waitForList(page)
    const allFilter = page.locator('.lists-menu > li.listViewFilter a.filterName').filter({ hasText: /^(All|Все)$/ }).first()
    await openListFilters(page)
    await allFilter.click()
    await waitForList(page)
    const sort = await requestsDuring(page, async () => {
      await page.locator('.listViewContentHeaderValues').nth(0).click()
    })
    await waitForList(page)
    const check = await requestsDuring(page, async () => {
      await page.locator('#listview-table .listViewEntriesCheckBox').first().check()
    })
    await page.locator('#listview-table .listViewEntriesCheckBox').first().uncheck()
    return { filter, sort, check, handlers: await handlerCounts(page) }
  }
  await page.goto(`${LIST}&modernui=off`)
  const v7 = await steps()
  await page.goto(`${LIST}&modernui=on`)
  await waitForShell(page)
  const themed = await steps()
  expect(themed.filter).toEqual(v7.filter)
  expect(themed.sort).toEqual(v7.sort)
  expect(themed.check).toEqual([])
  expect(themed.handlers).toEqual(v7.handlers)
  const conditionalHandlers = await page.evaluate(() => {
    const jq = (window as unknown as { jQuery: { _data: (element: unknown, name: string) => Record<string, { namespace?: string }[]> | undefined } }).jQuery
    return Object.values(jq._data(document, 'events') ?? {}).flat().filter((handler) => handler.namespace === 'modernuiConditionalLayouts').length
  })
  const adapters = (await page.locator('html').getAttribute('data-mu-adapters') ?? '').split(' ')
  expect(conditionalHandlers).toBe(adapters.includes('controllayoutfields') ? 1 : 0)

  // Sorted by the first column: its mark shows the direction in the accent colour.
  const mark = page.locator('.listViewContentHeaderValues').nth(0).locator('.fa-sort-asc, .fa-sort-desc')
  await expect(mark).toHaveCount(1)
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mu-primary').trim())
  expect(await mark.evaluate((element) => getComputedStyle(element).color)).toBe(await page.evaluate((hex) => {
    const probe = document.createElement('span')
    probe.style.color = hex
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, accent))

  // Select two rows: the mass actions of v7 are enabled, the rows marked, the check box of the theme drawn.
  const boxes = page.locator('#listview-table .listViewEntriesCheckBox')
  const rows = Math.min(2, await boxes.count())
  for (let index = 0; index < rows; index++) {
    await boxes.nth(index).check()
  }
  await expect(page.locator('#listview-table .listViewEntriesCheckBox:checked')).toHaveCount(rows)
  await expect(page.locator('.listViewActionsContainer > button').first()).toBeEnabled()
  expect(await boxes.first().evaluate((box) => [getComputedStyle(box).appearance, getComputedStyle(box).width])).toEqual(['none', '18px'])

  // Action without a change of data: the export dialog of the selected records, closed again.
  await page.locator('.listViewMassActions > .btn').click()
  const exportLink = page.locator('[id$="_listView_advancedAction_LBL_EXPORT"]')
  await expect(exportLink).toBeVisible()
  await exportLink.click()
  const overlay = page.locator('#overlayPageContent.in')
  await expect(overlay).toBeVisible()
  await expect(overlay.locator('form#exportForm')).toBeAttached()
  // The stage 17 cloud dialog sits above the page chrome; the former v7 panel below the navbar is no longer the target.
  const bounds = await overlay.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds?.y).toBeCloseTo(28, 0)
  expect(bounds?.width).toBeCloseTo(1140, 0)
  await overlay.locator('.cancelLink, [data-dismiss="modal"]').first().click({ trial: true })
  await overlay.locator('.cancelLink, [data-dismiss="modal"]').first().click()
  await expect(overlay).toHaveCount(0)
  await expect(page.locator('#listview-table .listViewEntriesCheckBox:checked')).toHaveCount(rows)

  // Clean stand: a real mass action on the synthetic records (star on, star off).
  if (isClean) {
    await page.locator('.listViewMassActions > .btn').click()
    await page.locator('[id$="_listView_massAction_LBL_ADD_STAR"]').click()
    await waitForList(page)
    await expect(page.locator('#listview-table .markStar.active').first()).toBeVisible()
    // Star off again for every starred row of the page: the synthetic records are left as they were.
    for (const row of await page.locator('#listview-table tr.listViewEntries:has(.markStar.active)').all()) {
      await row.locator('.listViewEntriesCheckBox').check()
    }
    await page.locator('.listViewMassActions > .btn').click()
    await page.locator('[id$="_listView_massAction_LBL_REMOVE_STAR"]').click()
    await waitForList(page)
    await expect(page.locator('#listview-table .markStar.active')).toHaveCount(0)
  }

  // Back to the list from a record: the shell, the active filter and the table are there again.
  const activeFilter = await page.locator('.lists-menu > li.listViewFilter.active a.filterName').textContent()
  const record = page.locator('#listview-table tr.listViewEntries td.listViewEntryValue a[href*="view=Detail"]').first()
  const recordId = new URL(await record.getAttribute('href') ?? '', page.url()).searchParams.get('record')
  expect(recordId).not.toBeNull()
  await record.click()
  // The record overlay intentionally keeps the list URL; its history entry identifies the opened record.
  await expect(page.locator('html')).toHaveAttribute('data-mu-record', recordId ?? '')
  await waitForShell(page)
  await page.goBack()
  await expect(page.locator('.mu-cloud-record')).toHaveCount(0)
  await waitForShell(page)
  await expect(page.locator('.lists-menu > li.listViewFilter.active a.filterName')).toHaveText(activeFilter ?? '')
  await expect(page.locator('#listview-table tr.listViewEntries').first()).toBeVisible()
  await expect(page.locator('#listview-table .listViewEntriesCheckBox').first()).toBeEnabled()
})

test('lists of the core and a custom module: the same actions, filters, columns and rows as v7; select and sort work', async ({ page }) => {
  const modules = ['Leads', 'Contacts', 'Accounts', 'SalesOrder', 'Invoice', 'Quotes', 'PurchaseOrder', 'Products', 'Services', 'PriceBooks', 'Vendors', ...(isClean ? ['Gadgets'] : []), ...(process.env['MU_LIST_MODULES'] ?? '').split(',').filter(Boolean)]
  const shape = async (): Promise<Record<string, unknown>> => page.evaluate(() => ({
    summaries: Array.from(document.querySelectorAll('#listViewContent div:has(> a[href]):has(> dd)')).map((card) => ({
      text: card.textContent.trim(), href: card.querySelector('a')?.getAttribute('href'),
      color: getComputedStyle(card).getPropertyValue('--mu-summary-accent').trim() || getComputedStyle(card).backgroundColor,
    })),
    actions: Array.from(document.querySelectorAll('.listViewActionsContainer [id], .listViewMassActions [id], .module-action-content [id]')).map((element) => element.id).filter((id) => !id.startsWith('mu-')).sort(),
    filters: document.querySelectorAll('.lists-menu > li.listViewFilter').length,
    columns: Array.from(document.querySelectorAll('.floatThead-table tr.listViewContentHeader th, #listview-table tr.listViewContentHeader th')).map((th) => th.textContent.trim()).filter((text) => text !== ''),
    rows: Array.from(document.querySelectorAll('#listview-table tr.listViewEntries')).map((row) => [row.getAttribute('data-id'), getComputedStyle(row).backgroundColor]),
    pagination: ['#PreviousPageButton', '#NextPageButton', '#PageJump'].map((selector) => document.querySelector(selector) !== null),
  }))
  for (const module of modules) {
    const url = `index.php?module=${module}&view=List`
    await page.goto(`${url}&modernui=off`)
    await page.waitForLoadState('networkidle')
    const v7 = await shape()
    await page.goto(`${url}&modernui=on`)
    await waitForShell(page)
    await expect(page.locator('html'), module).toHaveClass(/mu-shell-ready/)
    await page.waitForLoadState('networkidle')
    expect(await shape(), module).toEqual(v7)
    const boxes = page.locator('#listview-table .listViewEntriesCheckBox')
    if ((await boxes.count()) > 0) {
      await boxes.first().check()
      await expect(page.locator('.listViewActionsContainer > button').first(), module).toBeEnabled()
      await boxes.first().uncheck()
      await page.locator('.listViewContentHeaderValues').first().click()
      await waitForList(page)
      await expect(page.locator('.listViewContentHeaderValues').first().locator('.fa-sort-asc, .fa-sort-desc'), module).toHaveCount(1)
    }
    // No permanent rail on any list (Documents and reports had none in v7 already).
    await expect(page.locator('#modnavigator'), module).toBeHidden()
  }
})

test('lists: search → record → back, empty result, loading indicator, row menu after several AJAX re-renders', async ({ page }) => {
  await open(page, LIST)
  // A record with a name (a real CRM may have records with an empty name, sorted first).
  const named = page.locator('#listview-table tr.listViewEntries td.listViewEntryValue a[href*="view=Detail"]').filter({ hasText: /[\p{L}\p{N}]{4,}/u })
  const name = ((await named.first().textContent()) ?? '').trim()
  const word = /[\p{L}\p{N}]{4,}/u.exec(name)?.[0] ?? ''
  expect(word).not.toBe('')
  // The search field of the same column (the search row lives in the floating header of floatThead).
  const column = await named.first().evaluate((link) => {
    const cell = link.closest('td')
    return cell?.parentElement !== null && cell !== null ? Array.from(cell.parentElement.children).indexOf(cell) : -1
  })
  await openListSearch(page)
  const input = page.locator(`tr.searchRow:visible > th:nth-child(${String(column + 1)}) input.listSearchContributor`).first()
  await input.fill(word)
  await input.press('Enter')
  await waitForList(page)
  await expect(page.locator('#listview-table tr.listViewEntries').first()).toContainText(new RegExp(word, 'i'))
  // Since stage 13 the record opens over the searched list (docs/architecture.md §7.10): the address stays, Back closes the
  // record and the list with its search is there; without the cloud record (other modules) it is the full page of v7.
  const url = page.url()
  await named.first().click()
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-mu-record') || location.href.includes('view=Detail'))
  if (page.url().includes('view=Detail')) {
    await waitForShell(page)
    await page.goBack()
    await waitForShell(page)
  } else {
    expect(page.url()).toBe(url)
    await page.goBack()
    await expect(page.locator('html')).not.toHaveAttribute('data-mu-record')
  }
  // v7 keeps the search in the history (pushState): back is the searched list.
  expect(page.url()).toContain('search_params=')
  await expect(page.locator('#listview-table tr.listViewEntries').first()).toBeVisible()

  // Nothing found: the empty state of v7 in the theme's colours.
  await page.locator('tr.searchRow input.listSearchContributor:visible').first().fill('zzz-ModernUI-no-such-record')
  await page.locator('tr.searchRow input.listSearchContributor:visible').first().press('Enter')
  await waitForList(page)
  await expect(page.locator('.emptyRecordsDiv').first()).toBeVisible()
  expect(await page.locator('.emptyRecordsDiv .emptyRecordsContent').first().evaluate((element) => getComputedStyle(element).color)).toBe('rgb(89, 93, 93)')
  await page.locator('tr.searchRow input.listSearchContributor:visible').first().fill('')
  await page.locator('tr.searchRow input.listSearchContributor:visible').first().press('Enter')
  await waitForList(page)
  await expect(page.locator('#listview-table tr.listViewEntries').first()).toBeVisible()

  // The loading indicator of v7 is centred on a card.
  const loader = await page.evaluate(() => {
    const app = (window as unknown as { app: { helper: { showProgress: () => void; hideProgress: () => void } } }).app
    app.helper.showProgress()
    const inner = document.querySelector('#messageBar > div')
    const box = inner?.getBoundingClientRect()
    const result = { visible: !document.getElementById('messageBar')?.classList.contains('hide'), centre: box ? Math.round(box.left + box.width / 2) : 0, width: window.innerWidth }
    app.helper.hideProgress()
    return result
  })
  expect(loader.visible).toBe(true)
  expect(Math.abs(loader.centre - loader.width / 2)).toBeLessThan(30)

  // The menu of a row opens once (one handler) after the re-renders above.
  const toggle = page.locator('#listview-table tr.listViewEntries .table-actions .dropdown-toggle').first()
  await toggle.click()
  await expect(page.locator('#listview-table .table-actions .dropdown.open')).toHaveCount(1)
  await page.keyboard.press('Escape')
})

test('popup: selecting a record for a reference field uses the list of the popup, nothing is saved', async ({ page }) => {
  await open(page, 'index.php?module=Contacts&view=Edit&app=MARKETING')
  const field = page.locator('input[name="account_id"]').locator('xpath=ancestor::td[1]')
  await field.locator('.relatedPopup').click()
  const popup = page.locator('.modal.in #popupPageContainer, .modal.in .popupModal, #popupPageContainer').first()
  await expect(popup).toBeVisible()
  const row = page.locator('.modal.in .listViewEntries').first()
  await expect(row).toBeVisible()
  await row.click()
  await expect(page.locator('input[name="account_id"]')).not.toHaveValue('')
  await expect(page.locator('input[name="account_id_display"]')).not.toHaveValue('')
})

/** The element at the centre of a locator is the locator itself (or inside it): nothing covers it. */
async function reachable(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().evaluate((element) => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return box.width > 0 && hit !== null && (element.contains(hit) || hit.contains(element))
  })
}

test('header of the cloud (stage 11): one main row and the toolbar, the title, every action of the core in its new place', async ({ page }) => {
  await open(page, LIST)
  const geometry = await page.evaluate(() => {
    const box = (selector: string): { x: number; y: number; w: number; h: number } | null => {
      const element = document.querySelector(selector)
      if (element === null) {
        return null
      }
      const r = element.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    }
    return {
      nav: box('#page > nav.app-fixed-navbar'),
      row: box('#page > nav.app-fixed-navbar > .global-nav'),
      secondRow: box('#page > nav.app-fixed-navbar > .app-nav'),
      toolbar: box('#page > nav.app-fixed-navbar .module-action-bar'),
      title: box('#page > nav.app-fixed-navbar .module-title'),
      button: box('[data-mu-trigger="mega-menu"]'),
      search: box('#page > nav.app-fixed-navbar .search-link'),
      system: box('[data-mu-root="system-menu"]'),
      logo: box('#page > nav.app-fixed-navbar .logo-container'),
      user: box('#navbar a.userName'),
      add: box('#Accounts_listView_basicAction_LBL_ADD_RECORD'),
      main: box('.main-container'),
      filterInTitle: Array.from(document.querySelectorAll('#page > nav.app-fixed-navbar .module-breadcrumb .current-filter-name')).some((element) => element.getBoundingClientRect().width > 0),
    }
  })
  // Favorites 42 px, one row of 56 px over its last 2 px; the second row of v7 takes no space; the toolbar 52 px under it.
  expect(geometry.nav).toMatchObject({ y: 0, h: 96 })
  expect(geometry.row).toMatchObject({ y: 40, h: 56 })
  expect(geometry.secondRow?.h).toBe(0)
  expect(geometry.toolbar).toMatchObject({ y: 96, h: 52 })
  expect(geometry.main?.y).toBe(148)
  // The row: menu button at the left edge, the title next to it, the search, the system menu, the logo and the user last.
  expect(geometry.button).toMatchObject({ x: 24, y: 50, w: 36, h: 36 })
  expect(geometry.title?.x).toBe(68)
  // Centred in the row (40 … 96), within the ±2 px of the contract.
  expect(Math.abs((geometry.title?.y ?? 0) + (geometry.title?.h ?? 0) / 2 - 68)).toBeLessThanOrEqual(2)
  expect(geometry.filterInTitle).toBe(false)
  const order = [geometry.search, geometry.system, geometry.logo, geometry.user].map((item) => item?.x ?? -1)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  for (const item of [geometry.search, geometry.system, geometry.user]) {
    expect((item?.y ?? 0) >= 40 && (item?.y ?? 0) + (item?.h ?? 0) <= 96, JSON.stringify(item)).toBe(true)
  }
  expect((geometry.add?.y ?? 0) >= 96 && (geometry.add?.y ?? 0) + (geometry.add?.h ?? 0) <= 148).toBe(true)
  // Every action of the header can be clicked: nothing of the new layout covers it.
  for (const selector of ['#menubar_quickCreate', '#navbar a.userName', '#navbar a.fa-calendar', '.search-link .keyword-input', '#Accounts_listView_basicAction_LBL_ADD_RECORD', '.company-logo']) {
    if ((await page.locator(selector).count()) > 0) {
      expect(await reachable(page, selector), selector).toBe(true)
    }
  }

  // The global search of v7: the button opens into the field, Enter searches with the same request as v7, Escape leaves it.
  const query = isClean ? 'MU' : 'ООО'
  await page.goto(`${LIST}&modernui=off`)
  await page.waitForLoadState('networkidle')
  const v7Search = await requestsDuring(page, async () => {
    await page.locator('.keyword-input').fill(query)
    await page.locator('.keyword-input').press('Enter')
  })
  await open(page, `${LIST}&modernui=on`)
  await page.locator('.search-link .keyword-input').click()
  await expect(page.locator('.search-link .keyword-input')).toBeFocused()
  expect(await page.locator('.search-link').evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(300)
  const themeSearch = await requestsDuring(page, async () => {
    await page.keyboard.type(query, { delay: 20 })
    await page.keyboard.press('Enter')
  })
  // Polls of the CRM (telephony, reminders) may fall into the same moment: the requests of the search are compared.
  const searchOnly = (requests: string[]): string[] => requests.filter((entry) => !/Poll|Reminder|Notification/i.test(entry))
  expect(searchOnly(themeSearch)).toEqual(searchOnly(v7Search))
  expect(searchOnly(themeSearch).length).toBeGreaterThan(0)
  await expect(page.locator('.search-link .keyword-input')).toHaveValue(query)
  await open(page, LIST)
  await page.locator('.search-link .keyword-input').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.search-link .keyword-input')).not.toBeFocused()
  expect(await page.locator('.search-link').evaluate((element) => element.getBoundingClientRect().width)).toBe(34)

  // Quick create and the user menu of v7 open from their new places.
  await page.locator('#menubar_quickCreate').click()
  // (li#quickCreateModules has no height in v7 itself: its column floats; the entries are what counts.)
  await expect(page.locator('#menubar_quickCreate_Contacts')).toBeVisible()
  expect(await reachable(page, '#menubar_quickCreate_Contacts')).toBe(true)
  await page.locator('#menubar_quickCreate_Contacts').click()
  const form = page.locator('.modal-content form[name="QuickCreate"]')
  await expect(form).toBeVisible()
  await form.locator('.modal-footer .cancelLink, .modal-footer [data-dismiss="modal"]').first().click()
  await expect(form).toBeHidden()
  await page.locator('#navbar a.userName').click()
  await expect(page.locator('#navbar .logout-content')).toBeVisible()
  await expect(page.locator('#menubar_item_right_LBL_MY_PREFERENCES')).toBeVisible()
  await expect(page.locator('#menubar_item_right_LBL_SIGN_OUT')).toBeVisible()
  expect(await reachable(page, '#menubar_item_right_LBL_MY_PREFERENCES')).toBe(true)
  await page.locator('#navbar a.userName').click()

  // Extensions add an icon to the header and a button to the module header after the start: both appear in the new
  // places and can be clicked; the title keeps out of the way of the icons.
  await page.evaluate(() => {
    const icons = document.querySelector('#navbar ul.nav.navbar-nav')
    const item = document.createElement('li')
    item.innerHTML = '<div><a href="#" id="mu-test-header-icon" class="fa fa-star" title="Extension"></a></div>'
    icons?.prepend(item)
    const buttons = document.querySelector('#appnav ul.nav')
    const entry = document.createElement('li')
    entry.innerHTML = '<button type="button" id="mu-test-module-button" class="btn btn-default module-buttons">Extension</button>'
    buttons?.prepend(entry)
  })
  for (const selector of ['#mu-test-header-icon', '#mu-test-module-button']) {
    await expect(page.locator(selector)).toBeVisible()
    expect(await reachable(page, selector), selector).toBe(true)
  }
  const late = await page.evaluate(() => ({
    icon: document.getElementById('mu-test-header-icon')?.getBoundingClientRect().top ?? -1,
    button: document.getElementById('mu-test-module-button')?.getBoundingClientRect().top ?? -1,
    titleEnd: document.querySelector('#page > nav.app-fixed-navbar .module-action-content > :first-child')?.getBoundingClientRect().right ?? 0,
    firstAction: Math.min(...Array.from(document.querySelectorAll('#page > nav.app-fixed-navbar .global-nav .row > :has(> .search-links-container), #navbar > .navbar-nav > li')).map((element) => element.getBoundingClientRect().left)),
  }))
  expect(late.icon).toBeGreaterThanOrEqual(40)
  expect(late.icon).toBeLessThan(96)
  expect(late.button).toBeGreaterThanOrEqual(96)
  expect(late.button).toBeLessThan(148)
  expect(late.titleEnd).toBeLessThanOrEqual(late.firstAction)
  await page.evaluate(() => {
    document.getElementById('mu-test-header-icon')?.closest('li')?.remove()
    document.getElementById('mu-test-module-button')?.closest('li')?.remove()
  })

  // A list reloaded by AJAX keeps the header as it is.
  await page.locator('.listViewContentHeaderValues').first().click()
  await waitForList(page)
  expect(await page.evaluate(() => document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().height)).toBe(96)
  await expect(page.locator('[data-mu-root="system-menu"]')).toHaveCount(1)
})

test('no permanent rail on records and forms; the calendar views in the context navigation; the settings menu stays', async ({ page }) => {
  await open(page, LIST)
  const href = await page.locator('#listview-table tr.listViewEntries[data-id]').first().getAttribute('data-recordurl')
  expect(href).not.toBeNull()
  for (const url of [href ?? '', (href ?? '').replace('view=Detail', 'view=Edit')]) {
    await open(page, url)
    await expect(page.locator('#modnavigator'), url).toBeHidden()
    expect(await page.evaluate(() => (document.querySelector('.viewContent .content-area') ?? document.querySelector('.content-area'))?.getBoundingClientRect().left ?? -1), url).toBeLessThanOrEqual(16)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true)
  }

  // The calendar of v7 keeps its views in the strip: they are the context navigation of the toolbar, with the same links.
  const calendar = 'index.php?module=Calendar&view=Calendar'
  await page.goto(`${calendar}&modernui=off`)
  await page.waitForLoadState('load')
  const v7Views = await page.locator('#modnavigator .mod-switcher-container a[href]').evaluateAll((links) => links.map((link) => new URL(link.getAttribute('href') ?? '', document.baseURI).search))
  expect(v7Views.length).toBeGreaterThanOrEqual(2)
  await open(page, `${calendar}&modernui=on`)
  await expect(page.locator('#modnavigator')).toBeHidden()
  const context = page.locator('[data-mu-root="context-nav"]')
  await expect(context).toBeVisible()
  expect(await context.locator('a[href]').evaluateAll((links) => links.map((link) => new URL(link.getAttribute('href') ?? '', document.baseURI).search))).toEqual(v7Views)
  await expect(context.locator('a[aria-current="page"]')).toHaveCount(1)
  expect(await context.evaluate((element) => {
    const box = element.getBoundingClientRect()
    return box.top >= 96 && box.bottom <= 148
  })).toBe(true)
  for (const view of ['SharedCalendar', 'List']) {
    const link = context.locator(`a[href*="view=${view}"]`)
    if ((await link.count()) === 0) {
      continue
    }
    await Promise.all([page.waitForURL(new RegExp(`view=${view}`)), link.click()])
    await waitForShell(page)
    await expect(page.locator(`[data-mu-root="context-nav"] a[href*="view=${view}"]`)).toHaveAttribute('aria-current', 'page')
  }
  // The add buttons of the calendar view are its main actions, in the toolbar.
  await open(page, calendar)
  await page.waitForLoadState('networkidle')
  for (const id of ['#calendarview_basicaction_addevent', '#calendarview_basicaction_addtask']) {
    if ((await page.locator(id).count()) > 0) {
      // A trial click: visible, enabled, stable and the element itself receives the pointer.
      await page.locator(id).click({ trial: true, timeout: 10_000 })
    }
  }

  // The navigation of the settings is no rail of modules: it stays.
  await open(page, 'index.php?module=Vtiger&parent=Settings&view=Index')
  await expect(page.locator('#modnavigator.settingsNav')).toBeVisible()
  await expect(page.locator('.settingsgroup').first()).toBeVisible()
})

test('narrow screens: the bar scrolls, the menu takes the screen with sections as an accordion, no page scroll', async ({ page }) => {
  for (const width of [768, 412]) {
    await page.setViewportSize({ width, height: 860 })
    await open(page, LIST)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const trigger = page.locator(TRIGGER)
    const box = await trigger.boundingBox()
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0)
    await trigger.click()
    const panel = page.locator(PANEL)
    await expect(panel).toHaveClass(/mu-mega--narrow/)
    const sections = panel.locator('.mu-mega__section-toggle')
    await expect(sections.first()).toBeVisible()
    const id = (await panel.locator('.mu-mega__section-toggle[aria-expanded="false"]').first().getAttribute('aria-controls')) ?? ''
    const closed = panel.locator(`.mu-mega__section-toggle[aria-controls="${id}"]`)
    await closed.click()
    await expect(panel.locator(`#${id} a[href]`).first()).toBeVisible()
    await expect(closed).toHaveAttribute('aria-expanded', 'true')
    expect(await panel.evaluate((element) => element.getBoundingClientRect().width)).toBeLessThanOrEqual(width)
    await page.keyboard.press('Escape')
    // Every action of the header stays reachable: the logo and the title are on the screen; on a phone the collapsed
    // header of v7 opens its actions and the search from its toggles.
    expect(await reachable(page, '.company-logo'), `${String(width)} logo`).toBe(true)
    expect(await page.locator('#page > nav.app-fixed-navbar .module-title').evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && box.left >= 0 && box.top >= 40 && box.bottom <= 148
    }), `${String(width)} title`).toBe(true)
    if (width < 768) {
      const toggle = page.locator('#page > nav.app-fixed-navbar .navbar-header [data-target="#navbar"]')
      await expect(toggle).toBeVisible()
      await toggle.click()
      await expect(page.locator('#navbar a.userName')).toBeVisible()
      // The collapse of v7 animates its height: the trial click waits for it.
      await page.locator('#menubar_quickCreate').click({ trial: true, timeout: 10_000 })
      await toggle.click()
    } else {
      for (const selector of ['#menubar_quickCreate', '#navbar a.userName', '.search-link .keyword-input']) {
        expect(await reachable(page, selector), `${String(width)} ${selector}`).toBe(true)
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('languages: the navigation speaks RU, EN and DE; tab order and focus rings of the bar and the menu', async ({ page }) => {
  const texts: Record<string, [string, string]> = { 'ru-RU': ['Открыть меню', 'Избранное'], 'en-US': ['Open the menu', 'Favorites'], 'de-DE': ['Menü öffnen', 'Favoriten'] }
  await open(page, LIST)
  for (const [locale, [open1, favorites]] of Object.entries(texts)) {
    expect((await savePersonal(page, { locale })).ok).toBe(true)
    await open(page, LIST)
    await expect(page.locator(TRIGGER)).toHaveAttribute('aria-label', open1)
    await expect(page.locator('.mu-favbar')).toHaveAttribute('aria-label', favorites)
    const raw = await page.locator('.mu-favbar, [data-mu-root="mega-menu"]').evaluateAll((elements) => elements.map((element) => element.textContent).join(' '))
    expect(raw).not.toMatch(/\b(?:menu|favorites|rail)\.[a-z]/)
  }
  await clearPersonal(page)
  await open(page, LIST)
  // Focus rings: the star, the mega menu button.
  for (const selector of ['[data-mu-trigger="favorites"]', TRIGGER]) {
    await page.locator(selector).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    const ring = await page.locator(selector).evaluate((element) => getComputedStyle(element).boxShadow)
    expect(ring, selector).not.toBe('none')
  }
})
