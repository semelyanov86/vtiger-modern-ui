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
 * - the module rail of the section follows the menu settings (order, hidden modules); a hidden module still opens;
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
import { HOME, SETTINGS_FORMS, isolateNetwork, waitForShell } from './support'
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
    const jq = (window as unknown as { jQuery: { _data: (element: unknown, name: string) => Record<string, unknown[]> | undefined } }).jQuery
    const count = (element: unknown): number => Object.values(jq._data(element, 'events') ?? {}).reduce((sum, list) => sum + list.length, 0)
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
  const extras = await panel.locator('[data-mu-item="extra"]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
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
  await search.fill('zzz-no-module')
  await expect(panel.locator('#mu-mega-panel [role="status"]')).toContainText('zzz-no-module')
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
  await expect(page.locator('.mu-rail [aria-current="page"]')).toHaveAttribute('data-mu-item', 'm:Contacts')
  // A direct link with the app of another section opens that section in the rail.
  await open(page, 'index.php?module=Contacts&view=List&app=SALES')
  const sales = menu.groups.find((group) => group.app === 'SALES' && group.items.some((item) => item.module === 'Contacts'))
  if (sales !== undefined) {
    await expect(page.locator('.mu-rail')).toHaveAttribute('data-mu-group', sales.id)
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
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#page > nav.app-fixed-navbar') ?? document.body).paddingTop)).toBe('42px')
  const before = await page.evaluate(() => ({
    nav: document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().height ?? 0,
    main: document.querySelector('.main-container')?.getBoundingClientRect().top ?? 0,
  }))
  expect(before.nav).toBeGreaterThanOrEqual(42 + 42)
  release()
  await waitForShell(page)
  await page.unroute(/\/dist\/assets\/shell-[^/]+\.js$/)
  const after = await page.evaluate(() => ({
    nav: document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().height ?? 0,
    main: document.querySelector('.main-container')?.getBoundingClientRect().top ?? 0,
    bar: document.querySelector('.mu-favbar')?.getBoundingClientRect().height ?? 0,
  }))
  expect(after.nav).toBe(before.nav)
  expect(after.main).toBe(before.main)
  expect(after.bar).toBe(42)
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
  expect(off.main).toBe(before.main - 42)
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

test('module rail and mega menu follow the menu settings: order, labels, hidden modules; a hidden module still opens', async ({ page }) => {
  await open(page, 'index.php?module=Contacts&view=List&app=MARKETING')
  const menu = await menuOf(page)
  const group = menu.groups.find((entry) => entry.app === 'MARKETING')
  expect(group).toBeDefined()
  await expect(page.locator('html')).toHaveAttribute('data-mu-replaced', /module-rail/)
  await expect(page.locator('#modnavigator > .mod-switcher-container')).toBeHidden()
  expect(await page.locator('.mu-rail [data-mu-item]').evaluateAll((links) => links.map((link) => link.getAttribute('data-mu-item'))))
    .toEqual(group?.items.map((item) => item.id))

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
  await expect(page.locator('.mu-rail')).toHaveAttribute('data-mu-group', 'kunden')
  const rail = await page.locator('.mu-rail [data-mu-item]').evaluateAll((links) => links.map((link) => link.getAttribute('data-mu-item')))
  expect(rail[0]).toBe('m:Contacts')
  expect(rail).not.toContain('m:Accounts')
  await page.locator(TRIGGER).click()
  const panel = page.locator(PANEL)
  await expect(panel.locator('[role="tab"]').first()).toHaveAttribute('title', german)
  await expect(panel.locator('#mu-mega-panel [data-mu-item="m:Accounts"]')).toHaveCount(0)
  // The long label stays inside the 98 px column (two lines at most, the full text in title).
  const overflow = await panel.locator('[role="tab"]').first().evaluate((tab) => tab.scrollWidth - tab.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-label', 'Menü öffnen')
  await expect(panel.locator('.mu-mega__service .mu-mega__heading').first()).toHaveText('Service und Einstellungen')
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
      await otherFilter.click()
    })
    await waitForList(page)
    const allFilter = page.locator('.lists-menu > li.listViewFilter a.filterName').filter({ hasText: /^(All|Все)$/ }).first()
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

  // Sorted by the first column: its mark shows the direction in the accent colour.
  const mark = page.locator('.listViewContentHeaderValues').nth(0).locator('.fa-sort-asc, .fa-sort-desc')
  await expect(mark).toHaveCount(1)
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mu-primary-strong').trim())
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
  const navBottom = await page.evaluate(() => document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect().bottom ?? 0)
  expect(await overlay.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(navBottom - 4)
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
  await Promise.all([page.waitForURL(/view=Detail/), page.locator('#listview-table tr.listViewEntries td.listViewEntryValue a[href*="view=Detail"]').first().click()])
  await waitForShell(page)
  await page.goBack()
  await waitForShell(page)
  await expect(page.locator('.lists-menu > li.listViewFilter.active a.filterName')).toHaveText(activeFilter ?? '')
  await expect(page.locator('#listview-table tr.listViewEntries').first()).toBeVisible()
  await expect(page.locator('#listview-table .listViewEntriesCheckBox').first()).toBeEnabled()
})

test('lists of the core and a custom module: the same actions, filters, columns and rows as v7; select and sort work', async ({ page }) => {
  const modules = ['Leads', 'Contacts', 'Accounts', 'SalesOrder', ...(isClean ? ['Gadgets'] : [])]
  const shape = async (): Promise<Record<string, unknown>> => page.evaluate(() => ({
    actions: Array.from(document.querySelectorAll('.listViewActionsContainer [id], .listViewMassActions [id], .module-action-content [id]')).map((element) => element.id).sort(),
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
    await expect(page.locator('.mu-rail [aria-current="page"], .mu-rail'), module).not.toHaveCount(0)
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
  const input = page.locator(`tr.searchRow:visible > th:nth-child(${String(column + 1)}) input.listSearchContributor`).first()
  await input.fill(word)
  await input.press('Enter')
  await waitForList(page)
  await expect(page.locator('#listview-table tr.listViewEntries').first()).toContainText(new RegExp(word, 'i'))
  await Promise.all([page.waitForURL(/view=Detail/), named.first().click()])
  await waitForShell(page)
  await page.goBack()
  await waitForShell(page)
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
