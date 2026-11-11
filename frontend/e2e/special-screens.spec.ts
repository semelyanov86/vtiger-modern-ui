/**
 * Stage 17 — the remaining families of screens in the cloud composition (project "special-screens", docs/design.md §13.13):
 * calendar, home dashboard, reports (list, result, wizard), import, recycle bin, find duplicates, email templates and the
 * mail manager. Every functional check compares the same page of the same CRM in safe mode (v7) and with the theme: the
 * original controls, their items and the requests they send. The layout itself is compared with the cloud by the pairs of
 * dev/visual/special.json; here only what must hold for the user: nothing lost, nothing covered, nothing outside the page.
 *
 * Writes nothing of the CRM's data on the dev instance: the panel switch of the calendar is a preference of the user and is
 * switched back; the report wizard and the import stop before saving. On the clean stand the import runs to the mapping
 * step and is cancelled. Personal settings of ModernUI (the language of the theme) are written back at the end.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page, type Request } from '@playwright/test'
import { isClean } from './env'
import { openIn, settle, type Mode } from './records-support'
import { bootstrap, clearPersonal, savePersonal } from './settings-api'
import { waitForShell, watchErrors } from './support'

test.describe.configure({ mode: 'serial' })

const CALENDAR = 'index.php?module=Calendar&view=Calendar'
const SHARED = 'index.php?module=Calendar&view=SharedCalendar'
const DASHBOARD = 'index.php?module=Home&view=DashBoard'
const REPORTS = 'index.php?module=Reports&view=List'
const RECYCLE = 'index.php?module=RecycleBin&view=List'
const TEMPLATES = 'index.php?module=EmailTemplates&view=List'
const DUPLICATES = 'index.php?module=Contacts&view=FindDuplicates&fields[]=lastname'
const MAIL = 'index.php?module=MailManager&view=List'

let personal: Record<string, unknown> = {}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto(`${DASHBOARD}&modernui=on`)
  personal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto(`${DASHBOARD}&modernui=on`)
  await clearPersonal(page)
  if (Object.keys(personal).length) expect((await savePersonal(page, personal)).ok).toBe(true)
  await page.close()
})

/** Requests of the page while `action` runs: method, the URL without the cache buster and the form body. */
async function requestsDuring(page: Page, filter: (request: Request) => boolean, action: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const listener = (request: Request): void => {
    if (filter(request)) {
      const url = new URL(request.url())
      for (const name of ['_', 'modernui']) url.searchParams.delete(name)
      const body = (request.postData() ?? '').replace(/(^|&)(__vtrftk|_)=[^&]*/g, '')
      seen.push(`${request.method()} ${url.search} ${body}`)
    }
  }
  page.on('request', listener)
  try {
    await action()
    // A click without a navigation does not leave the network-idle state: wait for the follow-up requests of the page
    // (PJAX, then the extensions that react to its events) until the network is quiet for a while.
    let count = -1
    while (count !== seen.length) {
      count = seen.length
      await page.waitForTimeout(1500)
    }
    await settle(page)
  } finally {
    page.off('request', listener)
  }
  return seen.sort()
}

const crmRequest = (request: Request): boolean => request.url().includes('index.php') && request.resourceType() !== 'document'
  && !request.url().includes('module=ModernUI') && !/mode=(getNotifications|getRecentNotifications)|action=Notifications/.test(request.url() + (request.postData() ?? ''))

/** The page does not scroll horizontally; the listed controls are inside the viewport and nothing covers their centre. */
async function fitsViewport(page: Page, selectors: string[]): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow, 'no horizontal scrolling of the page').toBeLessThanOrEqual(1)
  const width = page.viewportSize()?.width ?? 0
  for (const selector of selectors) {
    const control = page.locator(selector).first()
    const box = await control.boundingBox()
    expect(box, `${selector} is shown`).not.toBeNull()
    expect((box?.x ?? 0) >= -1 && (box?.x ?? 0) + (box?.width ?? 0) <= width + 1, `${selector} inside the viewport`).toBe(true)
    const uncovered = await control.evaluate((element) => {
      const r = element.getBoundingClientRect()
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return top !== null && (element.contains(top) || top.contains(element))
    })
    expect(uncovered, `${selector} is not covered`).toBe(true)
  }
}

interface Feed { key: string; checked: boolean; colour: string }

async function feeds(page: Page): Promise<Feed[]> {
  await page.locator('.feedslist input.toggleCalendarFeed').first().waitFor({ state: 'attached' })
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('.feedslist input.toggleCalendarFeed')).map((input) => ({
    key: input.dataset['calendarSourcekey'] ?? '',
    checked: input.checked,
    colour: (input.closest('li') as HTMLElement | null)?.style.backgroundColor ?? '',
  })))
}

test('calendar: the calendars keep their colours and switches; toolbar, views and panel switch are those of v7', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = watchErrors(page)
  const contract: Record<Mode, { feeds: Feed[]; buttons: string[]; next: string[]; title: string[] }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, CALENDAR, mode)
    const buttons = await page.locator('.calendarview .fc-toolbar button').evaluateAll((all) => all.map((b) => [...b.classList].filter((c) => /^fc-[a-zA-Z]+-button$|^vt-goto-date$/.test(c)).join(' ')))
    const title = [await page.locator('.calendarview .fc-center h2').innerText()]
    const next = await requestsDuring(page, crmRequest, async () => { await page.locator('.calendarview .fc-next-button').click() })
    title.push(await page.locator('.calendarview .fc-center h2').innerText())
    await page.locator('.calendarview .fc-prev-button').click()
    title.push(await page.locator('.calendarview .fc-center h2').innerText())
    contract[mode] = { feeds: await feeds(page), buttons, next, title }
  }
  expect(contract.on).toEqual(contract.off)

  // Each calendar is drawn in its own colour (the check box), the row itself no longer carries it.
  const painted = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('.feedslist li.calendar-feed-indicator:not(.mass-edit-option) input.toggleCalendarFeed')).map((input) => {
    const row = input.closest('li') as HTMLElement
    return { inline: row.style.backgroundColor, row: getComputedStyle(row).backgroundColor, box: getComputedStyle(input).backgroundColor, checked: input.checked, label: row.querySelector(':scope > span')?.getBoundingClientRect().width ?? 0 }
  }))
  expect(painted.length).toBeGreaterThan(0)
  for (const feed of painted) {
    expect(feed.row).toBe('rgba(0, 0, 0, 0)')
    if (feed.checked && feed.inline !== '') expect(feed.box).toBe(feed.inline)
    expect(feed.label).toBeGreaterThan(40)
  }

  // Switching a calendar off and on: the same client behaviour (events removed and fetched again).
  const first = page.locator('.feedslist input.toggleCalendarFeed').first()
  const before = await first.isChecked()
  await first.click()
  await expect(first).toBeChecked({ checked: !before })
  await first.click()
  await expect(first).toBeChecked({ checked: before })

  // Views: the buttons of FullCalendar; the panel is hidden in the agenda as v7 hides it.
  for (const view of ['month', 'agendaWeek', 'agendaDay', 'vtAgendaList'] as const) {
    await page.locator(`.calendarview .fc-${view}-button`).click()
    await expect(page.locator(`.calendarview .fc-${view}-button`)).toHaveClass(/fc-state-active/)
  }
  await page.locator('.calendarview .fc-agendaWeek-button').click()

  // The panel switch is the native one (it stores the preference of the user): the same request, switched back.
  const toggle = async (): Promise<string[]> => requestsDuring(page, crmRequest, async () => { await page.locator('.calendarview .essentials-toggle').click() })
  const hide = await toggle()
  await expect(page.locator('#sidebar-essentials')).toBeHidden()
  const show = await toggle()
  await expect(page.locator('#sidebar-essentials')).toBeVisible()
  expect(hide.join()).toContain('toggleLeftPanel')
  expect(show.join()).toContain('toggleLeftPanel')
  expect(errors.page).toEqual([])
})

test('calendar: the shared calendar keeps the colours of the users; the date picker and quick create open', async ({ page }) => {
  await openIn(page, SHARED, 'on')
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>('.feedslist li.calendar-feed-indicator:not(.mass-edit-option) input.toggleCalendarFeed'))
    .map((input) => ({ inline: (input.closest('li') as HTMLElement).style.backgroundColor, box: getComputedStyle(input).backgroundColor, border: getComputedStyle(input).borderTopColor })))
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) if (row.inline !== '') expect(row.border).toBe(row.inline)
  await openIn(page, CALENDAR, 'on')
  await page.locator('.calendarview .vt-goto-date').click()
  await expect(page.locator('.datepicker:visible, .datepicker-dropdown:visible').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('#calendarview_basicaction_addevent').click()
  await expect(page.locator('.mu-quick-form')).toBeVisible()
  await page.locator('.mu-quick-form .cancelLink, .modal.in [data-dismiss="modal"]').first().click()
})

test('dashboard (clean stand): a widget added with the native menu becomes a card of the cloud and stays for the pairs', async ({ page }) => {
  test.skip(!isClean, 'the dashboard of the dev instance has widgets already; nothing is added there')
  await openIn(page, DASHBOARD, 'on')
  if (await page.locator('.tab-pane.active .dashboardWidget').count() === 0) {
    await page.locator('.tab-pane.active .dashboardHeading .addButton.dropdown-toggle').click()
    const item = page.locator('.tab-pane.active .dashboardHeading .widgetsList a').first()
    const added = await requestsDuring(page, crmRequest, async () => { await item.click() })
    expect(added.join(), 'the native request of the widget').toContain('view=ShowWidget')
  }
  const card = page.locator('.tab-pane.active .dashboardWidget').first()
  await expect(card).toBeVisible()
  expect(await card.evaluate((element) => [getComputedStyle(element).borderRadius, getComputedStyle(element).backgroundColor])).toEqual(['12px', 'rgb(255, 255, 255)'])
  // The handles of gridster and the icons of the widget stay where v7 puts them (special.spec compares them with v7).
  await expect(card.locator('.dashboardWidgetHeader')).toBeVisible()
})

test('dashboard: tabs, More and Add widget keep their native items; widgets are cards with their own handles', async ({ page }) => {
  const contract: Record<Mode, { tabs: string[]; add: string[]; more: string[] }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, DASHBOARD, mode)
    const tabs = await page.locator('.dashBoardContainer .nav-tabs li.dashboardTab').allInnerTexts()
    await page.locator('.tab-pane.active .dashboardHeading .addButton.dropdown-toggle').click()
    const add = await page.locator('.tab-pane.active .dashboardHeading .dropdown-menu a').allInnerTexts()
    await page.keyboard.press('Escape')
    await page.locator('body').click({ position: { x: 5, y: 500 } })
    await page.locator('.dashBoardContainer .moreSettings .dropdown-toggle').click()
    const more = await page.locator('.dashBoardContainer .moreSettings .dropdown-menu a').allInnerTexts()
    await page.locator('body').click({ position: { x: 5, y: 500 } })
    contract[mode] = { tabs: tabs.map((t) => t.trim()), add: add.map((t) => t.trim()), more: more.map((t) => t.trim()) }
  }
  expect(contract.on).toEqual(contract.off)
  // The band: tabs and both buttons in one row under the header, nothing covered.
  const tab = await page.locator('.dashBoardContainer .nav-tabs li.dashboardTab').first().boundingBox()
  const add = await page.locator('.tab-pane.active .dashboardHeading .addButton.dropdown-toggle').boundingBox()
  const more = await page.locator('.dashBoardContainer .moreSettings .dropdown-toggle').boundingBox()
  expect(Math.abs((tab?.y ?? 0) - (add?.y ?? 0))).toBeLessThanOrEqual(4)
  expect((more?.x ?? 0) + (more?.width ?? 0)).toBeLessThanOrEqual(add?.x ?? 0)
  await page.locator('.tab-pane.active .dashboardHeading .addButton.dropdown-toggle').click({ trial: true })
  const second = page.locator('.dashBoardContainer .nav-tabs li.dashboardTab').nth(1)
  if (await second.count()) {
    await second.locator('a').click()
    await expect(second).toHaveClass(/active/)
    await page.locator('.dashBoardContainer .nav-tabs li.dashboardTab').first().locator('a').click()
  }
})

test('reports: folders, search, Add menu and paging as in v7; the result and its exports send the same requests', async ({ page }) => {
  test.setTimeout(240_000)
  const list: Record<Mode, { folders: string[]; add: string[]; rows: number; folderRequest: string[] }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, REPORTS, mode)
    const folders = await page.locator('#sidebar-essentials .lists-menu a.filterName').evaluateAll((all) => all.map((a) => a.getAttribute('data-filter-id') ?? ''))
    await page.locator('#Reports_listView_basicAction_Add').click()
    const add = await page.locator('#appnav .dropdown-menu a:visible').allInnerTexts()
    await page.locator('#Reports_listView_basicAction_Add').click()
    await expect(page.locator('#appnav .dropdown-menu a:visible')).toHaveCount(0)
    if (mode === 'on') await page.locator('.mu-list-filter').click()
    const folder = page.locator('#sidebar-essentials .lists-menu a.filterName').nth(1)
    const folderRequest = await requestsDuring(page, crmRequest, async () => { await folder.click() })
    list[mode] = { folders, add: add.map((t) => t.trim()), rows: await page.locator('#listview-table tr.listViewEntries').count(), folderRequest }
  }
  expect(list.on).toEqual(list.off)
  await expect(page.locator('.mu-list-filter-label')).not.toHaveText('')

  // Result: header actions, conditions switch and the exports of the core.
  await openIn(page, REPORTS, 'on')
  const href = await page.locator('#listview-table tr.listViewEntries[data-recordurl*="view=Detail"]').first().getAttribute('data-recordurl')
  expect(href).toBeTruthy()
  const detail: Record<Mode, { actions: string[]; exports: string[] }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, href ?? '', mode)
    const actions = await page.locator('.reportHeader button').evaluateAll((all) => all.map((b) => `${b.getAttribute('name') ?? ''}|${b.textContent.trim()}`))
    const visible = await page.locator('#filterContainer').isVisible()
    await page.locator('button[name="modify_condition"]').click()
    await expect(page.locator('#filterContainer')).toBeVisible({ visible: !visible })
    await page.locator('button[name="modify_condition"]').click()
    await expect(page.locator('#filterContainer')).toBeVisible({ visible })
    // CSV: the native data-href, intercepted before the download.
    await page.route(/view=ExportReport/, (route) => route.abort())
    const exports = await requestsDuring(page, (r) => r.url().includes('view=ExportReport'), async () => {
      await page.locator('.reportHeader button.reportActions').filter({ hasText: /CSV/ }).first().click()
    })
    await page.unroute(/view=ExportReport/)
    detail[mode] = { actions, exports }
  }
  expect(detail.on).toEqual(detail.off)
  // The aborted export left an error page behind: the result again, its title in the header row of the cloud.
  await openIn(page, href ?? '', 'on')
  await expect(page.locator('.reportHeader h3')).toBeVisible()
  const bar = await page.locator('.reportsDetailHeader .reportHeader').boundingBox()
  const conditions = await page.locator('button[name="modify_condition"]').boundingBox()
  expect(Math.abs((conditions?.y ?? 0) + (conditions?.height ?? 0) / 2 - ((bar?.y ?? 0) + (bar?.height ?? 0) / 2))).toBeLessThanOrEqual(4)
})

test('report wizard: steps, validation and Next to step 2 as in v7; nothing is saved', async ({ page }) => {
  const step2: Record<Mode, { invalid: string; fields: string[]; active: string }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, 'index.php?module=Reports&view=Edit', mode)
    // An empty required name: the native validator keeps step 1 and marks the field (the same classes in both modes).
    await page.locator('.modal-overlay-footer .nextStep').click()
    await page.waitForTimeout(800)
    await expect(page.locator('#report_step1')).toBeVisible()
    const invalid = (await page.locator('#report_step1 [name="reportname"]').getAttribute('class') ?? '').split(/\s+/).filter((c) => /error|invalid/i.test(c)).sort().join(' ')
    await page.locator('#report_step1 [name="reportname"]').fill('MU17 wizard check (not saved)')
    await page.locator('.modal-overlay-footer .nextStep').click()
    await expect(page.locator('#report_step2, form[name="report_step2"]').first()).toBeVisible()
    const fields = await page.locator('#report_step2 [name], form[name="report_step2"] [name]').evaluateAll((all) => [...new Set(all.map((e) => e.getAttribute('name') ?? ''))].sort())
    step2[mode] = { invalid, fields, active: (await page.locator('.breadcrumb li.step.active').textContent() ?? '').replace(/\s+/g, ' ').trim() }
  }
  expect(step2.on).toEqual(step2.off)
  // The window: steps on top, the footer with the main action at the right end, inside the viewport.
  const next = await page.locator('.modal-overlay-footer .btn-success:visible').last().boundingBox()
  const cancel = await page.locator('.modal-overlay-footer .cancelLink:visible').last().boundingBox()
  expect((next?.x ?? 0)).toBeGreaterThan(cancel?.x ?? 0)
  await fitsViewport(page, ['.editContainer .breadcrumb li.step.active', '.modal-overlay-footer .btn-success:visible'])
})

test('import: the dialog, its steps and fields are those of v7; the wizard is cancelled before importing', async ({ page }) => {
  const csv = join(mkdtempSync(join(tmpdir(), 'mu17-')), 'mu17-contacts.csv')
  writeFileSync(csv, 'First Name,Last Name\nMU17,Import check\n')
  const steps: Record<Mode, { fields: string[]; crumbs: string[]; step2: boolean }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, 'index.php?module=Contacts&view=List', mode)
    if (mode === 'on') await page.locator('#appnav .mu-list-more').click()
    await page.locator('#appnav [id$="_basicAction_LBL_IMPORT"]').click()
    await expect(page.locator('#overlayPageContent .fc-overlay-modal')).toBeVisible()
    if (await page.locator('#overlayPageContent #csvImport').count()) await page.locator('#overlayPageContent #csvImport .menu-item').click()
    await expect(page.locator('#importContainer')).toBeVisible()
    const fields = await page.locator('form[name="importBasic"] [name]').evaluateAll((all) => [...new Set(all.map((e) => e.getAttribute('name') ?? ''))].sort())
    const crumbs = (await page.locator('#importContainer .breadcrumb li.step').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
    await page.locator('form[name="importBasic"] input[type="file"]').setInputFiles(csv)
    let step2 = false
    if (await page.locator('#importStep2').count()) {
      await page.locator('#importStep2').click()
      step2 = await page.locator('#importStepTwoButtonsDiv').isVisible()
    }
    steps[mode] = { fields, crumbs, step2 }
    if (mode === 'on') {
      // The dialog of the cloud: inside the viewport, header and footer visible, the main action at the right end.
      await fitsViewport(page, ['#overlayPageContent .overlayHeader', '#overlayPageContent .modal-overlay-footer .btn-success:visible'])
      const box = await page.locator('#overlayPageContent').boundingBox()
      expect((box?.height ?? 0)).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) - 40)
    }
    await page.locator('#overlayPageContent .cancelLink:visible').first().click()
    await expect(page.locator('#overlayPageContent .fc-overlay-modal')).toBeHidden()
  }
  expect(steps.on).toEqual(steps.off)
})

test('recycle bin, find duplicates, email templates and mail manager keep their native actions', async ({ page }) => {
  // Recycle bin: the modules of the panel are the native links; the record actions appear with a selection.
  const recycle: Record<Mode, { modules: string[]; empty: boolean }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, RECYCLE, mode)
    const modules = await page.locator('#sidebar-essentials .lists-menu a.filterName').evaluateAll((all) => all.map((a) => a.getAttribute('href') ?? ''))
    recycle[mode] = { modules, empty: await page.locator('#RecycleBin_listView_basicAction_LBL_EMPTY_RECYCLEBIN').isVisible() }
  }
  expect(recycle.on).toEqual(recycle.off)
  if (await page.locator('#listview-table .listViewEntriesCheckBox').count()) {
    await page.locator('#listview-table .listViewEntriesCheckBox').first().check()
    await expect(page.locator('#RecycleBin_listView_massAction_LBL_RESTORE')).toBeVisible()
    await expect(page.locator('.module-action-content h4.module-title')).toBeVisible()
    await page.locator('#listview-table .listViewEntriesCheckBox').first().uncheck()
  }
  await page.locator('.mu-list-filter').click()
  await expect(page.locator('#sidebar-essentials')).toBeVisible()
  const second = page.locator('#sidebar-essentials .lists-menu a.filterName').nth(1)
  if (await second.count()) {
    const target = await second.getAttribute('href')
    await second.click()
    await page.waitForURL((url) => url.href.includes(new URL(target ?? '', page.url()).searchParams.get('sourceModule') ?? '#'))
  }

  // Find duplicates: the list tree opens from the toolbar and closes with Escape; delete and the table stay.
  const duplicates: Record<Mode, { rows: number; remove: boolean }> = {} as never
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, DUPLICATES, mode)
    duplicates[mode] = { rows: await page.locator('#findDuplicateContents tr.listViewEntries').count(), remove: await page.locator('#Contacts_listView_basicAction_LBL_DELETE').isVisible() }
  }
  expect(duplicates.on).toEqual(duplicates.off)
  await expect(page.locator('#sidebar-essentials')).toBeHidden()
  await page.locator('.mu-list-filter').click()
  await expect(page.locator('#sidebar-essentials')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('#sidebar-essentials')).toBeHidden()
  await expect(page.locator('.mu-list-filter')).toBeFocused()

  // Email templates: the view switch of v7 (list / thumbnails) and the native add button.
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, TEMPLATES, mode)
    await expect(page.locator('#EmailTemplates_listView_basicAction_LBL_ADD_RECORD')).toBeVisible()
    await expect(page.locator('#listview-actions .viewType').first()).toBeVisible()
  }

  // Mail manager: the native start (create a mailbox) opens its own dialog; nothing is saved or sent.
  for (const mode of ['off', 'on'] as const) {
    await openIn(page, MAIL, mode)
    const create = page.locator('.mailbox-info button, #mailManagerContainer button, .main-container-MailManager .btn-success, .main-container-MailManager .btn-primary').first()
    if (await create.count()) {
      await create.click()
      await expect(page.locator('.modal.in, .modal-overlay-footer, #mailbox-settings').first()).toBeVisible()
      await page.keyboard.press('Escape')
    }
  }
})

test('narrow screens, 200 % and RU/EN/DE: the toolbars wrap, controls stay inside the page', async ({ page }) => {
  test.setTimeout(240_000)
  const screens: [string, string[]][] = [
    [CALENDAR, ['.calendarview .fc-today-button', '.calendarview .fc-next-button', '#calendarview_basicaction_addevent', '#calendarview_basicaction_addtask', '[data-mu-root="context-nav"] a']],
    [DASHBOARD, ['.dashBoardContainer .nav-tabs li.dashboardTab', '.tab-pane.active .dashboardHeading .addButton.dropdown-toggle']],
    [REPORTS, ['.mu-list-filter', '#Reports_listView_basicAction_Add']],
    [RECYCLE, ['.mu-list-filter', '#RecycleBin_listView_basicAction_LBL_EMPTY_RECYCLEBIN']],
  ]
  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    for (const [url, controls] of screens) {
      await openIn(page, url, 'on')
      await fitsViewport(page, controls)
    }
  }
  // 412 px: no horizontal scrolling of the page (toolbars wrap or scroll in their own row).
  await page.setViewportSize({ width: 412, height: 900 })
  for (const [url] of screens) {
    await openIn(page, url, 'on')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), url).toBeLessThanOrEqual(1)
  }
  // 200 %: a viewport of 720 CSS px.
  await page.setViewportSize({ width: 720, height: 450 })
  for (const [url] of screens) {
    await openIn(page, url, 'on')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), url).toBeLessThanOrEqual(1)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const labels: Record<string, string> = { 'ru-RU': 'Списки и теги', 'en-US': 'Lists and tags', 'de-DE': 'Listen und Tags' }
  for (const [locale, label] of Object.entries(labels)) {
    await page.goto(`${DASHBOARD}&modernui=on`)
    expect((await savePersonal(page, { locale })).ok).toBe(true)
    await openIn(page, DUPLICATES, 'on')
    await expect(page.locator('.mu-list-filter-label')).toHaveText(label)
    await expect(page.locator('#sidebar-essentials')).toHaveAttribute('aria-label', label)
  }
})

test('without the shell (standard view, no JavaScript) the calendar, dashboard and reports are those of v7', async ({ browser, page }) => {
  await openIn(page, CALENDAR, 'off')
  const v7 = await page.locator('.feedslist li.calendar-feed-indicator:not(.mass-edit-option)').first().evaluate((row) => getComputedStyle(row).backgroundColor)
  expect(v7).not.toBe('rgba(0, 0, 0, 0)')
  await openIn(page, CALENDAR, 'on')
  const context = await browser.newContext({ storageState: await page.context().storageState(), javaScriptEnabled: false, viewport: { width: 1440, height: 900 } })
  const noJs = await context.newPage()
  await noJs.goto(new URL(`${DASHBOARD}&modernui=on`, page.url()).href)
  // v7 renders the dashboard tabs on the server: without scripts they stay in the page flow, not in the fixed band.
  const tabs = noJs.locator('.dashBoardContainer .nav-tabs')
  if (await tabs.count()) expect(await tabs.evaluate((e) => getComputedStyle(e).position)).not.toBe('fixed')
  await noJs.goto(new URL(`${REPORTS}&modernui=on`, page.url()).href)
  const sidebar = noJs.locator('#sidebar-essentials')
  if (await sidebar.count()) expect(await sidebar.evaluate((e) => getComputedStyle(e).position)).not.toBe('fixed')
  await context.close()
  await page.goto(`${DASHBOARD}&modernui=on`)
  await waitForShell(page)
})

test('unknown and clean modules: a list of a module without own templates keeps the list composition (clean stand)', async ({ page }) => {
  test.skip(!isClean, 'the clean stand has the synthetic module Gadgets of the scenarios')
  await openIn(page, 'index.php?module=Gadgets&view=List', 'on')
  await expect(page.locator('html')).toHaveAttribute('data-mu-lists', '')
  await fitsViewport(page, ['.mu-list-filter', '#appnav [id$="_basicAction_LBL_ADD_RECORD"]'])
})
