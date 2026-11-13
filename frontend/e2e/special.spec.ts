/**
 * Stage 08 — special screens and adapters of extensions, as an administrator, on the dev instance and the clean stand (project
 * "special"). Every check compares the CRM with the theme and the same CRM in safe mode:
 *
 * - adapters of public extensions: only the adapters of the extensions that are installed, active and of a checked version
 *   reach a page (Bootstrap, the tokens stylesheet); switched off by the administrator they disappear, the extension's screen
 *   keeps the common skin; the settings editor shows each adapter with its status on this CRM;
 * - pages without a signed-in user and entry points outside the v7 interface (sign-in, forgotten password, installer, web
 *   forms, mobile and portal APIs, web services, short URLs, the mobile web client where installed) never get the theme;
 * - printing a page: the bars and buttons of the shell stay on the screen, the content starts where v7 starts it;
 * - export: the same request and the same file as without the theme;
 * - rich text editors: the editing area (CKEditor iframe) has no stylesheet of the theme;
 * - calendar: events stay draggable; on the clean stand a synthetic event is dragged to another time — the same request
 *   and the same result as without the theme;
 * - dashboard: widgets keep their drag handles and resize handles uncovered.
 *
 * Writes only on the clean stand (synthetic events MU08, deleted at the end) and the settings of ModernUI (written back).
 */
import { execFileSync } from 'node:child_process'
import { expect, test, type Browser, type Page, type Request } from '@playwright/test'
import { crmUrl, isClean, stateFile } from './env'
import { isolateNetwork, useLocalBuild } from './support'
import { deleteSynthetic, openIn, settle, token, withMode, type Mode } from './records-support'
import { bootstrap, editorData, globalScope, patchGlobal, saveGlobal, type Scope } from './settings-api'

test.describe.configure({ mode: 'serial' })

const localBuild = process.env['MU_E2E_LOCAL_BUILD'] === '1'
const MARK = 'MU08'
const RUN = Date.now().toString(36)

let original: Scope

async function adminPage(browser: Browser, viewport = { width: 1440, height: 900 }): Promise<Page> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport, storageState: stateFile('admin') })
  await isolateNetwork(context)
  if (localBuild) {
    await useLocalBuild(context)
  }
  return context.newPage()
}

interface AdapterInfo {
  id: string
  module: string
  status: string
  version: string
}

async function adapterCatalog(page: Page): Promise<AdapterInfo[]> {
  return (await editorData(page))['adapters'] as AdapterInfo[]
}

async function activeAdapters(page: Page): Promise<{ id: string; module: string; version: string }[]> {
  return (await bootstrap(page))['adapters'] as { id: string; module: string; version: string }[]
}

/** The tokens stylesheet of the current page: its URL (cache key) and its text. */
async function tokensSheet(page: Page): Promise<{ href: string; css: string }> {
  const href = await page.locator('link[rel="stylesheet"][href*="module=ModernUI&action=Tokens"]').first().getAttribute('href')
  expect(href, 'tokens stylesheet on the page').not.toBeNull()
  const response = await page.request.get(href ?? '')
  return { href: href ?? '', css: await response.text() }
}

test.beforeAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  original = await globalScope(page)
  await page.context().close()
})

test.afterAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  const current = await globalScope(page)
  const saved = await saveGlobal(page, original.values, current.revision)
  expect(saved.ok, `settings written back: ${saved.text.slice(0, 200)}`).toBe(true)
  await page.context().close()
})

test('adapters: only the adapters of active extensions of a checked version reach the page; switched off they are gone', async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  const catalog = await adapterCatalog(page)
  expect(catalog.length, 'the registry of this version has adapters').toBeGreaterThan(0)
  for (const adapter of catalog) {
    expect(['active', 'disabled', 'notInstalled', 'inactive', 'version', 'incomplete'], `${adapter.id}: status`).toContain(adapter.status)
  }
  const expected = catalog.filter((adapter) => adapter.status === 'active').map((adapter) => adapter.id).sort()
  expect((await activeAdapters(page)).map((adapter) => adapter.id).sort(), 'Bootstrap lists the active adapters only').toEqual(expected)
  const sheet = await tokensSheet(page)
  const styles: Record<string, boolean> = { pdfmaker: true, controllayoutfields: false }
  for (const adapter of catalog) {
    expect(styles[adapter.id], `${adapter.id}: resource contract is specified`).toBeDefined()
    const styled = adapter.status === 'active' && styles[adapter.id] === true
    expect(sheet.css.includes(`ModernUI adapter ${adapter.id} `), `${adapter.id}: stylesheet ${styled ? 'appended' : 'not loaded'}`)
      .toBe(styled)
  }
  if (isClean) {
    // A clean 8.4.0 has none of the extensions: every adapter is "not installed" and nothing of them reaches the page.
    expect(expected, 'no active adapter on a clean CRM').toEqual([])
    expect(catalog.every((adapter) => adapter.status === 'notInstalled')).toBe(true)
  }
  if (expected.length === 0) {
    await page.context().close()
    return
  }

  // Switched off by the administrator: gone from Bootstrap and from the stylesheet (whose URL changes), back when on.
  await patchGlobal(page, { 'adapters.disabled': expected })
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  expect(await activeAdapters(page), 'no adapter while switched off').toEqual([])
  const off = await tokensSheet(page)
  expect(off.href, 'the cache key of the tokens stylesheet changes').not.toBe(sheet.href)
  for (const id of expected) {
    expect(off.css.includes(`ModernUI adapter ${id} `), `${id}: not in the stylesheet while switched off`).toBe(false)
  }
  expect((await adapterCatalog(page)).filter((adapter) => expected.includes(adapter.id)).map((adapter) => adapter.status))
    .toEqual(expected.map(() => 'disabled'))
  if (expected.includes('pdfmaker')) {
    // The editor of PDF Maker: the common skin (14 px tabs) without its adapter, 12 px tabs of v7 with it.
    const tabs = 'form#EditView:has(.PDFMakerContentBlock) > ul.layoutTabs > li > a'
    await page.goto('index.php?module=PDFMaker&view=Edit&modernui=on')
    await expect(page.locator(tabs).first()).toBeVisible()
    const without = await page.locator(tabs).first().evaluate((element) => getComputedStyle(element).fontSize)
    await patchGlobal(page, { 'adapters.disabled': null })
    await page.goto('index.php?module=PDFMaker&view=Edit&modernui=on')
    const withAdapter = await page.locator(tabs).first().evaluate((element) => getComputedStyle(element).fontSize)
    await page.goto('index.php?module=PDFMaker&view=Edit&modernui=off')
    const v7 = await page.locator(tabs).first().evaluate((element) => getComputedStyle(element).fontSize)
    expect(withAdapter, 'tabs of the PDF Maker editor with the adapter: as in v7').toBe(v7)
    expect(without, 'without the adapter: the common skin').not.toBe(v7)
    const rows = await page.locator(tabs).evaluateAll((links) => new Set(links.map((link) => Math.round(link.getBoundingClientRect().top))).size)
    await page.goto('index.php?module=PDFMaker&view=Edit&modernui=on')
    expect(await page.locator(tabs).evaluateAll((links) => new Set(links.map((link) => Math.round(link.getBoundingClientRect().top))).size),
      'rows of tabs with the adapter, as in v7').toBeLessThanOrEqual(rows)
  } else {
    await patchGlobal(page, { 'adapters.disabled': null })
  }
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  expect((await activeAdapters(page)).map((adapter) => adapter.id).sort(), 'back on').toEqual(expected)
  await page.context().close()
})

test('settings editor: every adapter with its status on this CRM; only an installed, checked extension can be switched', async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto('index.php?module=ModernUI&parent=Settings&view=Index&modernui=on')
  await page.locator('[data-mu-tab="compatibility"]').click()
  const table = page.locator('[data-mu-table="adapters"]')
  await expect(table).toBeVisible()
  for (const adapter of await adapterCatalog(page)) {
    const row = table.locator(`[data-mu-adapter="${adapter.id}"]`)
    await expect(row).toHaveAttribute('data-mu-status', adapter.status)
    const box = row.locator('input[type="checkbox"]')
    if (adapter.status === 'active' || adapter.status === 'disabled') {
      await expect(box).toBeEnabled()
      await expect(box).toBeChecked({ checked: adapter.status === 'active' })
      // A switch changes the draft only (status of the draft), nothing is saved here.
      await box.click()
      await expect(row).toHaveAttribute('data-mu-status', adapter.status === 'active' ? 'disabled' : 'active')
      await box.click()
      await expect(row).toHaveAttribute('data-mu-status', adapter.status)
    } else {
      await expect(box).toBeDisabled()
    }
    // The status text is a translated text of the theme, not a code.
    await expect(row.locator('td').nth(3)).not.toHaveText(/^[a-z][A-Za-z]+$/)
  }
  await page.context().close()
})

test('pages without a signed-in user and entry points outside the v7 interface never get the theme', async ({ browser }) => {
  // An empty session: contexts of the tests otherwise get the signed-in state of the project.
  const outside = await browser.newContext({ baseURL: crmUrl(), storageState: { cookies: [], origins: [] } })
  await isolateNetwork(outside)
  const anonymous = await outside.newPage()
  const signedIn = await adminPage(browser)
  // GET only, without parameters: none of them does anything without its own data (no cron, no submission).
  const entries = [
    'index.php', 'index.php?module=Users&view=Login', 'forgotPassword.php', 'shorturl.php', 'public.php',
    'index.php?module=Install&view=Index', 'webservice.php', 'modules/Webforms/capture.php', 'modules/Mobile/api.php',
    'modules/CustomerPortal/api.php', 'modules/crmtogo/index.php', 'index.php?module=ModernUI&action=Tokens',
  ]
  const checked: string[] = []
  for (const page of [anonymous, signedIn]) {
    const who = page === anonymous ? 'anonymous' : 'admin'
    for (const entry of entries) {
      if (who === 'admin' && entry.startsWith('index.php')) {
        // Pages of the CRM itself for a signed-in user: the theme applies there by design (and the sign-in view is not meant
        // for a signed-in user — some builds fail on it, with the theme or without).
        continue
      }
      const response = await page.request.get(entry, { maxRedirects: 5 }).catch(() => null)
      if (response === null || response.status() === 404) {
        continue
      }
      const body = await response.text()
      checked.push(`${who} ${entry} ${String(response.status())}`)
      if (body.includes('data-mu-auth=')) {
        // The sign-in pages of ModernUI, installed by the administrator (docs/auth-pages.md, 0.14.1): their own stylesheet
        // and fonts, but none of the interface of the CRM — no loader, shell, skin or tokens of a user.
        expect(body.includes('resources/loader.js'), `${who} ${entry}: no loader of the shell`).toBe(false)
        expect(/dist\/assets\/(?:skin|shell)-/.test(body), `${who} ${entry}: no skin or shell`).toBe(false)
        expect(body.includes('module=ModernUI&action=Tokens'), `${who} ${entry}: no tokens stylesheet`).toBe(false)
        continue
      }
      expect(body.includes('modules/ModernUI/resources'), `${who} ${entry}: no resources of the theme`).toBe(false)
      expect(body.includes('module=ModernUI&action=Tokens'), `${who} ${entry}: no tokens stylesheet`).toBe(false)
      expect(/--mu-[a-z]/.test(body), `${who} ${entry}: no design tokens`).toBe(false)
    }
  }
  // The print view of a report (its own page of v7, opened by "Print"): what v7 prints, without the theme.
  await signedIn.goto(withMode('index.php?module=Reports&view=List', 'off'))
  const report = await signedIn.locator('tr.listViewEntries[data-recordurl*="view=Detail"]').first().getAttribute('data-recordurl').catch(() => null)
  const reportId = report === null ? null : new URL(report, crmUrl()).searchParams.get('record')
  if (reportId !== null) {
    await signedIn.goto('index.php?module=Home&view=DashBoard&modernui=on')
    const print = await signedIn.request.get(`index.php?module=Reports&view=ExportReport&mode=GetPrintReport&record=${reportId}`)
    const body = await print.text()
    expect(print.status()).toBe(200)
    expect(body.includes('modules/ModernUI/resources') || body.includes('module=ModernUI&action=Tokens'), 'print view of a report: no theme').toBe(false)
    checked.push('admin report print view')
  }
  // The sign-in page is drawn by the browser as v7 draws it (or as the installed sign-in page of ModernUI): never the shell.
  await anonymous.goto('index.php')
  if (await anonymous.locator('[data-mu-auth]').count() > 0) {
    await expect(anonymous.locator('script[src*="resources/loader.js"], link[href*="dist/assets/skin-"], link[href*="action=Tokens"]')).toHaveCount(0)
    expect(await anonymous.evaluate(() => document.documentElement.classList.contains('mu-shell-ready'))).toBe(false)
  } else {
    await expect(anonymous.locator('link[href*="ModernUI"], script[src*="ModernUI"]')).toHaveCount(0)
    expect(await anonymous.evaluate(() => document.documentElement.className.includes('mu-'))).toBe(false)
  }
  expect(checked.length, `entry points checked: ${checked.join(', ')}`).toBeGreaterThanOrEqual(6)
  await outside.close()
  await signedIn.context().close()
})

/** Top of the content of the page and the visible elements of the shell, as the browser prints the page. */
async function printLayout(page: Page): Promise<{ content: number; shell: number }> {
  await page.emulateMedia({ media: 'print' })
  const layout = await page.evaluate(() => {
    const content = document.querySelector('.main-container, #page .content-area, #page')
    const shell = Array.from(document.querySelectorAll('[data-mu-root="favorites"], [data-mu-root="mega-menu"], [data-mu-root="system-menu"], #mu-overlay-root'))
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).display !== 'none').length
    return { content: Math.round(content?.getBoundingClientRect().top ?? -1), shell }
  })
  await page.emulateMedia({ media: 'screen' })
  return layout
}

test('printing: the bars and buttons of the shell stay on the screen, the content starts where v7 prints it', async ({ browser }) => {
  const page = await adminPage(browser)
  for (const url of ['index.php?module=Contacts&view=List', 'index.php?module=Home&view=DashBoard']) {
    await openIn(page, url, 'off')
    const v7 = await printLayout(page)
    await openIn(page, url, 'on')
    const theme = await printLayout(page)
    expect(theme.shell, `${url}: no shell on paper`).toBe(0)
    expect(Math.abs(theme.content - v7.content), `${url}: content starts as in v7 (${String(theme.content)} / ${String(v7.content)})`).toBeLessThanOrEqual(2)
  }
  await page.context().close()
})

/** Fields of a POST body without the CSRF token. */
function fields(request: Request): Record<string, string> {
  const result = Object.fromEntries(new URLSearchParams(request.postData() ?? '').entries())
  delete result['__vtrftk']
  return result
}

test('export: the same request and the same file as without the theme (current page of a list)', async ({ browser }) => {
  const page = await adminPage(browser)
  const results: Record<string, { request: Record<string, string>; sha: string }> = {}
  for (const mode of ['off', 'on'] as Mode[]) {
    await openIn(page, 'index.php?module=Contacts&view=List', mode)
    await page.locator('a[onclick*="triggerExportAction"]').first().evaluate((node: HTMLElement) => {
      node.click()
    })
    const form = page.locator('#exportForm, form[name="exportForm"], form:has(input[name="mode"][value^="Export"])').first()
    await expect(form).toBeVisible()
    await form.locator('input[type="radio"][value="ExportCurrentPage"]').check()
    // The request of v7 is recorded and aborted: no file on disk (the dev instance has real data); the same request is
    // repeated in memory to compare the file.
    let captured: Request | null = null
    await page.route((url) => url.pathname.endsWith('/index.php'), async (route) => {
      const request = route.request()
      if (request.method() === 'POST' && (request.postData() ?? '').includes('ExportData')) {
        captured = request
        await route.abort()
        return
      }
      await route.fallback()
    })
    await form.locator('button[type="submit"]').first().click()
    await expect.poll(() => captured !== null).toBe(true)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    const request = captured as unknown as Request
    const response = await page.request.post('index.php', { form: Object.fromEntries(new URLSearchParams(request.postData() ?? '').entries()) })
    expect(response.status()).toBe(200)
    const body = await response.body()
    const { createHash } = await import('node:crypto')
    results[mode] = { request: fields(request), sha: createHash('sha256').update(body).digest('hex') }
    expect(body.length, `${mode}: a file`).toBeGreaterThan(10)
  }
  expect(results['on']?.request, 'what the export form sends').toEqual(results['off']?.request)
  expect(results['on']?.sha, 'the exported file').toBe(results['off']?.sha)
  await page.context().close()
})

test('rich text editors: the editing area of CKEditor has no stylesheet of the theme and the font of v7', async ({ browser }) => {
  const page = await adminPage(browser)
  const fonts: Record<string, string> = {}
  for (const mode of ['off', 'on'] as Mode[]) {
    await openIn(page, 'index.php?module=Documents&view=Edit', mode)
    const frame = page.locator('iframe.cke_wysiwyg_frame').first()
    await expect(frame).toBeVisible({ timeout: 20_000 })
    const inside = await frame.evaluate((element: HTMLIFrameElement) => {
      const doc = element.contentDocument
      if (doc === null) {
        return null
      }
      const sheets = Array.from(doc.querySelectorAll('link[rel="stylesheet"], style')).map((node) => node.getAttribute('href') ?? node.textContent.slice(0, 200))
      return { theme: sheets.some((sheet) => sheet.includes('ModernUI') || sheet.includes('--mu-')), font: getComputedStyle(doc.body).fontFamily, mu: doc.documentElement.className }
    })
    expect(inside, `${mode}: the editing area`).not.toBeNull()
    expect(inside?.theme, `${mode}: no stylesheet of the theme inside the editor`).toBe(false)
    fonts[mode] = inside?.font ?? ''
  }
  expect(fonts['on'], 'the text of the editor keeps the font of v7').toBe(fonts['off'])
  await page.context().close()
})

test('dashboard: widgets keep their drag handles and resize handles, uncovered, as in v7', async ({ browser }) => {
  const page = await adminPage(browser)
  const state: Record<string, { widgets: number; handles: number; covered: number }> = {}
  for (const mode of ['off', 'on'] as Mode[]) {
    await openIn(page, 'index.php?module=Home&view=DashBoard', mode)
    state[mode] = await page.evaluate(() => {
      const widgets = Array.from(document.querySelectorAll('.dashboardWidget, li.dashboardWidget'))
      let covered = 0
      for (const widget of widgets) {
        const header = widget.querySelector('.dashboardWidgetHeader') ?? widget
        const rect = header.getBoundingClientRect()
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.width === 0) {
          continue
        }
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 12))
        if (hit === null || !widget.contains(hit)) {
          covered += 1
        }
      }
      return { widgets: widgets.length, handles: document.querySelectorAll('.gs-resize-handle, .ui-resizable-handle').length, covered }
    })
  }
  expect(state['on'], 'widgets, resize handles and covered headers').toEqual(state['off'])
  expect(state['on']?.covered).toBe(0)
  await page.context().close()
})

test('calendar: events stay draggable; a synthetic event dragged to another time sends the same request as v7 (clean stand)', async ({ browser }) => {
  const page = await adminPage(browser)
  const draggable: Record<string, number> = {}
  for (const mode of ['off', 'on'] as Mode[]) {
    await openIn(page, 'index.php?module=Calendar&view=Calendar', mode)
    await page.locator('.fc-agendaWeek-button').click()
    await page.waitForTimeout(800)
    draggable[mode] = await page.locator('.fc-event.fc-draggable, .fc-event[class*="fc-draggable"]').count()
    // The grid where events are dropped is not covered by anything of the theme.
    const slot = page.locator('.fc-slats tr').nth(4)
    const box = await slot.boundingBox()
    expect(box, `${mode}: time grid`).not.toBeNull()
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('.fc-view-container') !== null, [(box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2])
    expect(hit, `${mode}: time grid reachable`).toBe(true)
  }
  expect(draggable['on'], 'draggable events of the week').toBe(draggable['off'])
  if (!isClean) {
    // The dev instance gets no record of the scenarios here: dropping would change a real event.
    await page.context().close()
    return
  }
  // Leftovers of an interrupted run (synthetic events MU08 only).
  await page.goto(withMode(`index.php?module=Calendar&view=List&search_params=${encodeURIComponent(JSON.stringify([[['subject', 'c', `${MARK}-`]]]))}`, 'off'))
  for (const id of await page.locator('tr.listViewEntries[data-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-id') ?? ''))) {
    await deleteSynthetic(page, 'Calendar', id, MARK)
  }
  const requests: Record<string, Record<string, string>> = {}
  const created: string[] = []
  try {
    for (const mode of ['off', 'on'] as Mode[]) {
      const subject = `${MARK}-${mode}-${RUN} Größe`
      await openIn(page, 'index.php?module=Calendar&view=Calendar', mode)
      await page.locator('.fc-agendaWeek-button').click()
      await page.waitForTimeout(600)
      // A click on a free slot of today at 10:00 opens the quick create of v7 with that time.
      const today = page.locator('.fc-day-header.fc-today').first()
      const column = await today.boundingBox()
      const row = await page.locator('.fc-slats tr[data-time="10:00:00"]').boundingBox()
      expect(column !== null && row !== null, `${mode}: today at 10:00`).toBe(true)
      await page.mouse.click((column?.x ?? 0) + (column?.width ?? 0) / 2, (row?.y ?? 0) + (row?.height ?? 0) / 2)
      const form = page.locator('form[name="QuickCreate"]')
      await expect(form).toBeVisible({ timeout: 20_000 })
      // The quick create of v7 sets its default times after it has opened: fill once it has settled.
      await page.waitForTimeout(800)
      await form.locator('input[name="subject"]').fill(subject)
      // One hour (the quick create of v7 proposes the default call duration, too short to grab the event).
      const start = await form.locator('input[name="time_start"]').inputValue()
      const end = start.replace(/^10:/, '11:')
      await form.locator('input[name="time_end"]').fill(end)
      await form.locator('input[name="time_end"]').press('Tab')
      await page.waitForTimeout(300)
      await expect(form.locator('input[name="time_end"]')).toHaveValue(end)
      const saved = page.waitForResponse((response) => response.request().method() === 'POST'
        && (response.request().postData() ?? '').includes('action=SaveAjax') && (response.request().postData() ?? '').includes(`${MARK}-${mode}-${RUN}`))
      await form.locator('button[name="saveButton"], button[type="submit"]').first().click()
      const answer = (await (await saved).json()) as { result?: { _recordId?: string | number; id?: string | number } }
      let id = String(answer.result?._recordId ?? answer.result?.id ?? '').replace(/^\d+x/, '')
      if (!/^\d+$/.test(id)) {
        // Vtiger 8.4.0 on PHP 8.5 answers this save with an error of the core ("Failed to parse time string ( )") and still
        // saves the event — with the theme and without it. The event is then found by its subject and the week shown again.
        await page.goto(withMode(`index.php?module=Calendar&view=List&search_params=${encodeURIComponent(JSON.stringify([[['subject', 'c', `${MARK}-${mode}-${RUN}`]]]))}`, mode))
        id = (await page.locator('tr.listViewEntries[data-id]').first().getAttribute('data-id', { timeout: 15_000 })) ?? ''
        await openIn(page, 'index.php?module=Calendar&view=Calendar', mode)
        await page.locator('.fc-agendaWeek-button').click()
        await page.waitForTimeout(800)
      }
      expect(id, `${mode}: saved event`).toMatch(/^\d+$/)
      created.push(id)
      const event = page.locator('.fc-time-grid-event', { hasText: subject }).first()
      await expect(event).toBeVisible({ timeout: 20_000 })
      // v7 fetches the events again after the save and draws them anew: grab the event once that is done.
      await settle(page)
      await page.waitForTimeout(1000)
      // Two rows of the grid down (one hour): measured in this mode, so a different row height cannot change the result.
      const slotHeight = (await page.locator('.fc-slats tr').first().boundingBox())?.height ?? 21
      const place = await event.boundingBox()
      expect(place).not.toBeNull()
      const x = (place?.x ?? 0) + (place?.width ?? 0) / 2
      const y = (place?.y ?? 0) + 8
      const dropped = page.waitForRequest((request) => (request.postData() ?? '').includes('updateDeltaOnDrop'), { timeout: 20_000 })
      expect(await page.evaluate(([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.closest('.fc-time-grid-event') !== null, [x, y]),
        `${mode}: the event is under the pointer`).toBe(true)
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x, y + slotHeight, { steps: 5 })
      await page.mouse.move(x, y + slotHeight * 2 + 2, { steps: 5 })
      await page.mouse.up()
      const request = await dropped
      const response = await request.response()
      expect(((await response?.json()) as { success?: boolean } | undefined)?.success, `${mode}: drop saved`).toBe(true)
      const sent = fields(request)
      delete sent['id']
      requests[mode] = sent
      await settle(page)
    }
    expect(requests['on'], 'what the calendar sends for the drop').toEqual(requests['off'])
    expect(requests['on']?.['secondsDelta']).toBe('3600')
  } finally {
    for (const id of created) {
      await deleteSynthetic(page, 'Calendar', id, MARK)
    }
    await page.goto(withMode('index.php?module=Home&view=DashBoard', 'on'))
    expect(await token(page)).not.toBe('')
    await page.context().close()
  }
})

test('pdf of the core (clean stand): the same document as without the theme', async ({ browser }) => {
  test.skip(!isClean, 'the dev instance: the PDF of an extension is compared by the records scenarios (stage 07)')
  const page = await adminPage(browser)
  await page.goto(withMode('index.php?module=SalesOrder&view=List', 'off'))
  const id = await page.locator('tr.listViewEntries[data-id]').first().getAttribute('data-id')
  expect(id).not.toBeNull()
  const texts: Record<string, string> = {}
  for (const mode of ['off', 'on'] as Mode[]) {
    await page.goto(withMode(`index.php?module=SalesOrder&view=Detail&record=${id ?? ''}`, mode))
    const response = await page.request.get(`index.php?module=SalesOrder&action=ExportPDF&record=${id ?? ''}`)
    expect(response.status()).toBe(200)
    const pdf = await response.body()
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF')
    texts[mode] = execFileSync('pdftotext', ['-layout', '-', '-'], { input: pdf }).toString()
  }
  expect(texts['on'], 'text of the PDF').toBe(texts['off'])
  await page.context().close()
})
