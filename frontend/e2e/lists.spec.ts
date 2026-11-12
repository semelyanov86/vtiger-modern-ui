/** Stage 12: the native list in the cloud composition, measured against Chrome's cloud reference and against v7. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page, type Request } from '@playwright/test'
import { cleanUserCredentials, crmUrl, isClean, reportDir } from './env'
import { bootstrap, clearPersonal, globalScope, patchGlobal, savePersonal } from './settings-api'
import { isolateNetwork, openListFilters, openListSearch, signIn, waitForShell } from './support'

const LIST = 'index.php?module=Accounts&view=List&app=MARKETING&page=1'
const shots = process.env['MU_LIST_SHOTS_DIR'] ?? ''
test.use({ viewport: { width: 1440, height: 1000 } })
test.beforeEach(async ({ context }) => { await isolateNetwork(context) })

async function open(page: Page, mode = 'on', url = LIST): Promise<void> {
  await page.goto(`${url}&modernui=${mode}`)
  if (mode === 'on') await waitForShell(page)
  await page.waitForLoadState('networkidle')
}

async function settled(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#messageBar')).toHaveClass(/hide/)
}

async function cancelFilter(page: Page): Promise<void> {
  await page.locator('#overlayPageContent .cancelLink, #overlayPageContent [data-dismiss="modal"]').first().click()
  const confirm = page.locator('.bootbox.modal.in [data-bb-handler="confirm"]')
  if (await confirm.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false)) await confirm.click()
  await expect(page.locator('#overlayPageContent.in')).toBeHidden()
}

async function selected(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as unknown as {
    Vtiger_List_Js: { getInstance: () => { readSelectedIds: () => unknown } }
  }).Vtiger_List_Js.getInstance().readSelectedIds())
}

async function geometry(page: Page): Promise<Record<string, number[]>> {
  return page.evaluate(() => {
    const result: Record<string, number[]> = {}
    for (const [key, selector] of Object.entries({
      filter: '.mu-list-filter', panel: '#sidebar-essentials', table: '#table-content',
      head: '.floatThead-table .listViewContentHeader, #listview-table .listViewContentHeader',
      row: '#listview-table tr.listViewEntries', add: '#appnav button[id$="_LBL_ADD_RECORD"]',
      tail: '#listview-actions', next: '#NextPageButton', split: '.mu-list-more',
    })) {
      const element = document.querySelector(selector)
      if (element !== null) {
        const r = element.getBoundingClientRect()
        result[key] = [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10)
      }
    }
    result['page'] = [document.documentElement.clientWidth, document.documentElement.scrollWidth]
    return result
  })
}

test('cloud geometry, filter disclosure, native filter search/create/edit and split Import; Escape and focus', async ({ page }) => {
  await open(page)
  await expect(page.locator('#sidebar-essentials')).toBeHidden()
  expect(await page.locator('.main-container').evaluate((element) => {
    const r = element.getBoundingClientRect()
    return r.bottom >= innerHeight - 30 && getComputedStyle(element).backgroundColor === 'rgb(239, 240, 242)'
  }), 'cloud page background fills the space below a short list').toBe(true)
  await expect(page.locator('tr.searchRow')).toBeHidden()
  const sizes = await geometry(page)
  // Reference V03, 1440x1000, trial banner (40px) excluded: table y144, toolbar y96..148, panel x24/y150/w288.
  expect(sizes['table']?.slice(0, 3)).toEqual([0, 144, 1440])
  expect(sizes['head']?.[3]).toBe(50)
  expect(sizes['row']?.[3]).toBe(40)
  expect(sizes['filter']?.[0]).toBe(24)
  expect(sizes['filter']?.[3]).toBe(36)
  expect(sizes['split']?.slice(2)).toEqual([27, 34])
  expect(sizes['add']?.[0]).toBeLessThan(sizes['tail']?.[0] ?? 0)
  await page.locator('.mu-list-filter').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.search-list')).toBeFocused()
  const panel = (await geometry(page))['panel']
  expect(panel?.slice(0, 3)).toEqual([24, 150, 288])
  await page.locator('.search-list').fill('zz-MU12-no-list')
  await page.locator('.search-list').press('ArrowRight') // native search is keyup, not input
  await expect(page.locator('.lists-menu li.listViewFilter:visible')).toHaveCount(0)
  await page.locator('.search-list').fill('')
  await page.locator('.search-list').press('ArrowRight')
  await expect(page.locator('.lists-menu li.listViewFilter:visible').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.mu-list-filter')).toBeFocused()
  await expect(page.locator('#sidebar-essentials')).toBeHidden()

  // Creation/editing are the actual v7 form, with the same URL and fields. No filter is changed by this check.
  for (const mode of ['off', 'on']) {
    await open(page, mode)
    await openListFilters(page)
    await page.locator('#createFilter').click()
    await expect(page.locator('#overlayPageContent.in')).toBeVisible()
    await expect(page.locator('#overlayPageContent input[name="viewname"]')).toBeVisible()
    await cancelFilter(page)
    await openListFilters(page)
    const settings = page.locator('#sidebar-essentials [data-editable="true"]').first()
    if (await settings.count()) {
      await settings.locator('xpath=ancestor::li[1]').hover()
      await settings.click()
      const edit = page.locator('#module-filters .popover.in .editFilter')
      await expect(edit).toBeVisible()
      await edit.click()
      await expect(page.locator('#overlayPageContent input[name="viewname"]')).toBeVisible()
      await cancelFilter(page)
    }
  }
  await page.locator('.mu-list-more').click()
  await expect(page.locator('#appnav button[id$="_LBL_IMPORT"]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.mu-list-more')).toBeFocused()
  await expect(page.locator('#appnav button[id$="_LBL_IMPORT"]')).toBeHidden()
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), 'lists-geometry.json'), JSON.stringify({ sizes, panel }, null, 2))
})

test('sort, search, pagination and selection send identical full native parameters with and without the theme', async ({ page }) => {
  const results: unknown[] = []
  for (const mode of ['off', 'on']) {
    await open(page, mode)
    const all = await page.locator('.lists-menu a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('href')
    await open(page, mode, `${all ?? LIST}&page=1&orderby=accountname&sortorder=ASC`)
    const requests: [string, string][][] = []
    const listener = (request: Request): void => {
      if (!['xhr', 'fetch'].includes(request.resourceType())) return
      const params = new URLSearchParams(`${new URL(request.url()).search.slice(1)}&${request.postData() ?? ''}`)
      if (!['List', 'ListAjax'].includes(params.get('view') ?? '')) return
      requests.push([...params].filter(([key]) => !['__vtrftk', '_', 't', '_pjax'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
    }
    page.on('request', listener)
    await page.locator('.listViewContentHeaderValues').first().click()
    await settled(page)
    await page.locator('#listview-table .listViewEntriesCheckBox').first().check()
    const ids = await selected(page)
    expect(ids).not.toEqual([])
    if (await page.locator('#NextPageButton').isEnabled()) {
      await page.locator('#NextPageButton').click()
      await settled(page)
      expect(await selected(page)).toEqual(ids)
      await page.locator('#PreviousPageButton').click()
      await settled(page)
      await expect(page.locator('#listview-table .listViewEntriesCheckBox:checked')).toHaveCount(1)
    }
    await page.locator('#listview-table .listViewEntriesCheckBox:checked').uncheck()
    await openListSearch(page)
    const search = page.locator('tr.searchRow input.listSearchContributor:visible').first()
    await search.fill('MU12-no-such-record')
    await search.press('Enter')
    await settled(page)
    await expect(page.locator('.emptyRecordsDiv')).toBeVisible()
    await search.fill('')
    await search.press('Enter')
    await settled(page)
    page.off('request', listener)
    results.push({ requests, ids })
  }
  expect(results[1]).toEqual(results[0])
})

test('RU EN DE, narrow screens and 200 percent: original controls stay reachable, scrolling stays inside the table', async ({ page }) => {
  test.setTimeout(240_000)
  await open(page)
  const original = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  const output: Record<string, unknown> = {}
  try {
    for (const locale of ['ru-RU', 'en-US', 'de-DE']) {
      expect((await savePersonal(page, { ...original, locale })).ok).toBe(true)
      for (const [width, height] of [[1440, 1000], [1024, 900], [768, 900], [412, 900], [720, 500]]) {
        await page.setViewportSize({ width: width ?? 1440, height: height ?? 1000 })
        await open(page)
        for (const selector of ['.mu-list-filter', '.mu-list-search', '#appnav button[id$="_LBL_ADD_RECORD"]', '.listViewMassActions > button', '#PageJump']) {
          const reachable = await page.locator(selector).evaluate((element) => {
            const r = element.getBoundingClientRect()
            return r.width > 0 && r.x >= 0 && r.right <= window.innerWidth && element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          })
          expect(reachable, `${locale} ${String(width)} ${selector}`).toBe(true)
        }
        const sizes = await geometry(page)
        expect(sizes['page']?.[1]).toBeLessThanOrEqual((sizes['page']?.[0] ?? 0) + 1)
        if ((width ?? 1440) < 768) {
          const filter = await page.locator('.mu-list-controls').boundingBox()
          const title = await page.locator('.module-action-content h4.module-title').boundingBox()
          expect(title, 'the module title stays visible beside the filter').not.toBeNull()
          expect((filter?.x ?? 0) + (filter?.width ?? 0), 'filter and module title do not overlap')
            .toBeLessThanOrEqual(title?.x ?? 0)
        }
        if ((width ?? 1440) <= 1100) {
          expect((sizes['add']?.[1] ?? 0) + (sizes['add']?.[3] ?? 0), 'module actions stay above the pagination row')
            .toBeLessThanOrEqual(sizes['tail']?.[1] ?? 0)
        }
        await openListFilters(page)
        await expect(page.locator('#createFilter')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.locator('.mu-list-filter')).toBeFocused()
        output[`${locale}-${String(width)}`] = sizes
        if (shots !== '') {
          mkdirSync(shots, { recursive: true })
          await page.screenshot({ path: resolve(shots, `V03-${locale}-${String(width)}.png`) })
        }
      }
    }
  } finally {
    await clearPersonal(page)
    if (Object.keys(original).length > 0) await savePersonal(page, original)
  }
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), 'lists-responsive.json'), JSON.stringify(output, null, 2))
})

test('native column configuration, tag dialog and page jump remain reachable with the same fields as v7', async ({ page }) => {
  const states: unknown[] = []
  for (const mode of ['off', 'on']) {
    await open(page, mode)
    const all = await page.locator('.lists-menu a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('href')
    await open(page, mode, `${all ?? LIST}&page=1`)
    await page.locator('.listColumnFilter:not(.disabled)').first().click()
    const columns = page.locator('.modal.in .configColumnsForm')
    await expect(columns).toBeVisible()
    const fields = await columns.locator('#selectedFieldsList .item, #avialFieldsList .item').evaluateAll((items) => items.map((item) => [item.getAttribute('data-cv-columnname'), item.textContent.trim()]))
    await columns.locator('.cancelLink, [data-dismiss="modal"]').first().click()
    await expect(columns).toBeHidden()
    await page.locator('#listview-table .listViewEntriesCheckBox').first().check()
    await page.locator('.listViewMassActions > button').click()
    await page.locator('[id$="_listView_massAction_LBL_ADD_TAG"]').click()
    const tags = page.locator('.modal.in .detailShowAllModal')
    await expect(tags.locator('[name="createNewTag"]')).toBeVisible()
    const options = await tags.locator('[name]').evaluateAll((fields) => fields.map((field) => [field.getAttribute('name'), field.getAttribute('type')]))
    await tags.locator('.cancelLink, [data-dismiss="modal"]').first().click()
    await expect(tags).toBeHidden()
    await page.locator('#listview-table .listViewEntriesCheckBox:checked').uncheck()
    await page.locator('#PageJump').click()
    await expect(page.locator('#pageToJump')).toBeVisible()
    if (mode === 'on') {
      const field = await page.locator('#pageToJump').boundingBox()
      const button = await page.locator('#pageToJumpSubmit').boundingBox()
      expect(field).not.toBeNull()
      expect(button).not.toBeNull()
      expect(Math.abs((field?.y ?? 0) - (button?.y ?? 0))).toBeLessThan(1)
      expect(Math.abs((field?.height ?? 0) - (button?.height ?? 0))).toBeLessThan(1)
      expect(field?.height).toBeGreaterThanOrEqual(34)
      expect((button?.x ?? 0) - (field?.x ?? 0) - (field?.width ?? 0)).toBeGreaterThanOrEqual(8)
    }
    await page.locator('#pageToJump').fill('1')
    await page.locator('#pageToJumpSubmit').click()
    await settled(page)
    expect(await page.locator('#pageNumber').inputValue()).toBe('1')
    states.push({ fields, options })
  }
  expect(states[1]).toEqual(states[0])
})

test('the whole user menu covers list actions, and pagination stays clickable after closing it', async ({ page }) => {
  for (const width of [1920, 1024, 412]) {
    await page.setViewportSize({ width, height: 1000 })
    await open(page)
    const headerToggle = page.locator('#page > nav.app-fixed-navbar .navbar-header [data-target="#navbar"]')
    if (width < 768) await headerToggle.click()
    await page.locator('#navbar a.userName').click()
    const menu = page.locator('#navbar .logout-content')
    await expect(menu).toBeVisible()
    // Checking only Preferences misses the photo and user name: the toolbar used to paint above that part.
    expect(await menu.evaluate((element) => {
      const r = element.getBoundingClientRect()
      return [16, 40, 64, 112, 160].every((dy) => [0.25, 0.5, 0.75].every((dx) =>
        element.contains(document.elementFromPoint(r.x + r.width * dx, r.y + dy))))
    }), `profile is unobstructed at ${String(width)}px`).toBe(true)
    // On phones the native profile popup can cover its trigger; Escape is the Bootstrap dismissal path.
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    if (width < 768) await headerToggle.click()
    await page.locator('#PageJump').click()
    const popup = page.locator('#PageJumpDropDown')
    await expect(popup).toBeVisible()
    const box = await popup.boundingBox()
    expect(box?.x).toBeGreaterThanOrEqual(0)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
    await page.locator('#pageToJump').fill('1')
    await page.locator('#pageToJumpSubmit').click()
    await settled(page)
    expect(await page.locator('#pageNumber').inputValue()).toBe('1')
  }
})

test('wide lists have one scrollbar per axis and the floating header follows horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 900 })
  await open(page, 'on', 'index.php?module=SalesOrder&view=List&app=SALES&page=1')
  const container = page.locator('#table-content')
  await expect(page.locator('#listview-table tr.listViewEntries').first()).toBeVisible()
  expect(await container.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
  // A short list's centre lies under the floating header, which is a sibling of the scrolling container.
  await page.locator('#listview-table tr.listViewEntries .listViewEntryValue').first().hover()
  // The browser's overflow:auto already supplies both rails; the plugin must not draw a second pair over them.
  await expect(container.locator(':scope > .ps-scrollbar-x-rail')).toBeHidden()
  await expect(container.locator(':scope > .ps-scrollbar-y-rail')).toBeHidden()
  const table = page.locator('#listview-table')
  const header = page.locator('.floatThead-table')
  const before = { table: await table.boundingBox(), header: await header.boundingBox() }
  await page.mouse.wheel(300, 0)
  await expect.poll(() => container.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100)
  await expect.poll(async () => {
    const bodyShift = (before.table?.x ?? 0) - ((await table.boundingBox())?.x ?? 0)
    const headerShift = (before.header?.x ?? 0) - ((await header.boundingBox())?.x ?? 0)
    return Math.abs(bodyShift - headerShift)
  }).toBeLessThan(1)
  await page.mouse.wheel(10_000, 0)
  await expect.poll(() => container.evaluate((element) =>
    Math.abs(element.scrollWidth - element.clientWidth - element.scrollLeft))).toBeLessThan(2)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('restricted user sees the same records, permissions and native column restrictions as v7', async ({ browser, page }) => {
  test.skip(!isClean, 'synthetic restricted account of the clean stand')
  await open(page)
  const previous = (await globalScope(page)).values['theme.mode']
  await patchGlobal(page, { 'theme.mode': 'all' })
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const limited = await context.newPage()
  try {
    await signIn(limited, cleanUserCredentials('limited'))
    const states: unknown[] = []
    for (const mode of ['off', 'on']) {
      await open(limited, mode)
      states.push(await limited.evaluate(() => ({
        ids: Array.from(document.querySelectorAll('#listview-table tr[data-id]')).map((r) => r.getAttribute('data-id')),
        actions: Array.from(document.querySelectorAll('#appnav button[id], .listViewActionsContainer [id]')).map((el) => el.id),
        columnsDisabled: document.querySelector('.listColumnFilter')?.classList.contains('disabled'),
      })))
      await openListFilters(limited)
      await expect(limited.locator('.lists-menu a.filterName').first()).toBeVisible()
    }
    expect(states[1]).toEqual(states[0])
    await limited.goto('index.php?module=Leads&view=List&modernui=on')
    await expect(limited.locator('#listview-table')).toHaveCount(0)
  } finally {
    await patchGlobal(page, { 'theme.mode': previous ?? null })
    await context.close()
  }
})

test('failed PJAX list request falls back to a full page and sorting recovers as in v7', async ({ page }) => {
  const states: unknown[] = []
  for (const mode of ['off', 'on']) {
    await open(page, mode)
    const all = await page.locator('.lists-menu a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('href')
    await open(page, mode, `${all ?? LIST}&page=1&orderby=accountname&sortorder=ASC`)
    const ids = (): Promise<(string | null)[]> => page.locator('#listview-table tr[data-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-id')))
    let failed = false
    await page.route('**/index.php*', async (route) => {
      const request = route.request()
      const params = new URLSearchParams(`${new URL(request.url()).search.slice(1)}&${request.postData() ?? ''}`)
      if (!failed && ['xhr', 'fetch'].includes(request.resourceType()) && ['List', 'ListAjax'].includes(params.get('view') ?? '')) {
        failed = true
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false,"error":{"code":"MU12_TEST","message":"MU12 temporary test failure"}}' })
      } else await route.continue()
    })
    const error = page.waitForResponse((response) => response.status() === 500)
    // The native PJAX error handler retries as a full document navigation; wait for that document, not the old one.
    const fallback = page.waitForResponse((response) => response.request().isNavigationRequest() && response.request().frame() === page.mainFrame())
    await page.locator('.listViewContentHeaderValues').first().click()
    await error
    await (await fallback).finished()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('#listview-table tr[data-id]').first()).toBeVisible()
    if (mode === 'on') await waitForShell(page)
    states.push({
      rows: await ids(),
      params: [...new URL(page.url()).searchParams].filter(([key]) => !['modernui', '_pjax', '_'].includes(key)),
      messages: await page.locator('.vt-notification:visible, #messageBar:visible').allTextContents(),
    })
    await page.unroute('**/index.php*')
    await page.locator('.listViewContentHeaderValues').first().click()
    await settled(page)
    await expect(page.locator('#listview-table tr[data-id]').first()).toBeVisible()
  }
  expect(states[1]).toEqual(states[0])
})
