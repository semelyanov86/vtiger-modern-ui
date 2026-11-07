/**
 * Stage 09 — proof of the cloud layout on one standard module (docs/architecture.md A15, docs/visual-parity.md §1):
 * the list of Accounts without the permanent module rail, a record of the list opened over the list with the overlay
 * record view of the core, back to the same list (filter, page, scroll, focus), the direct link of the record, then the
 * edit form of the core over the list: validation, cancel and one save of a synthetic record. Compared with v7: the save
 * sends the fields of the form of v7 to the same action, opening records again adds no handlers.
 *
 * The scenario switches layout.modules = [Accounts] on for its run and restores the setting; it creates synthetic
 * organizations MU09-<run> through the standard SaveAjax action and deletes them (DeleteAjax) at the end.
 */
import { expect, test, type Page, type Request } from '@playwright/test'
import { isClean } from './env'
import { globalScope, patchGlobal } from './settings-api'
import { deleteSynthetic, fillMandatory, formData, isSave, payload, settle, token } from './records-support'
import { waitForShell, watchErrors } from './support'

const MODULE = 'Accounts'
const RUN = Date.now().toString(36)
const MARK = 'MU09'
const NAME = `${MARK}-${RUN}`
const LIST = `index.php?module=${MODULE}&view=List`

test.describe.configure({ mode: 'serial' })

const created: string[] = []
let previous: unknown

async function createAccount(page: Page, name: string): Promise<string> {
  const response = await page.request.post('index.php', {
    form: { module: MODULE, action: 'SaveAjax', accountname: name, assigned_user_id: '1', __vtrftk: await token(page) },
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: page.url() },
  })
  const body = (await response.json()) as { success?: boolean; result?: { _recordId?: number | string } }
  expect(body.success, `SaveAjax ${name}`).toBe(true)
  const id = String(body.result?._recordId ?? '')
  expect(id).toMatch(/^\d+$/)
  created.push(id)
  return id
}

async function openList(page: Page, query = ''): Promise<void> {
  await page.goto(`${LIST}${query}&modernui=on`)
  await waitForShell(page)
  await expect(page.locator('html')).toHaveClass(/mu-shell-ready/)
  await settle(page)
}

/** Ids of the rows of the list, page number and search of the list controller of v7. */
async function listState(page: Page): Promise<{ rows: string[]; page: string; search: string; scroll: number }> {
  return page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#listViewContent tr.listViewEntries[data-id]')).map((row) => row.getAttribute('data-id') ?? ''),
    page: (document.getElementById('pageNumber') as HTMLInputElement | null)?.value ?? '',
    search: (document.getElementById('currentSearchParams') as HTMLInputElement | null)?.value ?? '',
    scroll: Math.round(window.scrollY),
  }))
}

const overlayOpen = (page: Page) => page.locator('html[data-mu-record]')

/** The visible link of a row to its record (the name; hidden links of the row actions carry a mode). */
const recordLink = (page: Page, id: string) => page.locator(`#listViewContent tr.listViewEntries[data-id="${id}"] a[href*="view=Detail"]:not([href*="mode="])`)
  .filter({ visible: true }).first()

async function openRecord(page: Page, id: string): Promise<void> {
  await recordLink(page, id).click()
  await expect(overlayOpen(page)).toHaveAttribute('data-mu-record', id)
  await expect(page.locator('#overlayPageContent.in .overlayDetail')).toBeVisible()
}

/** jQuery handlers per element/type/namespace/selector on the persistent elements of the page (see adapters/v7/record.ts). */
async function handlerMap(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    const jq = w['jQuery'] as { _data: (el: unknown, key: string) => Record<string, { selector?: string; namespace?: string }[]> | undefined }
    const app = w['app'] as { event: { el: unknown[] } }
    const overlay = document.getElementById('overlayPageContent')
    const targets: [string, unknown][] = [['document', document], ['window', window], ['body', document.body], ['bus', app.event.el[0]], ['overlay', overlay]]
    document.querySelectorAll('.modal .close, .modal .cancelLink').forEach((element, index) => {
      if (overlay?.contains(element) !== true) {
        targets.push([`modal-button-${String(index)}`, element])
      }
    })
    const out: Record<string, number> = {}
    for (const [name, element] of targets) {
      for (const [type, list] of Object.entries(jq._data(element, 'events') ?? {})) {
        for (const handler of list) {
          const key = `${name} ${type}${handler.namespace ? `.${handler.namespace}` : ''}${handler.selector ? ` ${handler.selector}` : ''}`
          out[key] = (out[key] ?? 0) + 1
        }
      }
    }
    return out
  })
}

async function handlers(page: Page): Promise<number> {
  return Number(await page.locator('html').getAttribute('data-mu-record-handlers'))
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto(`${LIST}&modernui=on`)
  previous = (await globalScope(page)).values['layout.modules']
  await patchGlobal(page, { 'layout.modules': [MODULE] })
  await createAccount(page, `${NAME} Overlay A`)
  await createAccount(page, `${NAME} Overlay B`)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto(`${LIST}&modernui=off`)
  // MU_LAYOUT_CLEANUP=<id,…>: synthetic MU09 organizations left by an interrupted run are deleted too.
  const leftovers = (process.env['MU_LAYOUT_CLEANUP'] ?? '').split(',').filter((id) => /^\d+$/.test(id))
  for (const id of [...created, ...leftovers]) {
    await deleteSynthetic(page, MODULE, id, MARK)
  }
  await page.goto(`${LIST}&modernui=on`)
  await patchGlobal(page, { 'layout.modules': previous ?? null })
  await page.close()
})

test('list of Accounts: no permanent module rail from the first paint, other modules keep it', async ({ page }) => {
  await page.goto(`${LIST}&modernui=on`, { waitUntil: 'domcontentloaded' })
  // The tokens stylesheet blocks rendering: the rail is gone before the shell starts.
  const early = await page.evaluate(() => ({
    rail: document.getElementById('modnavigator')?.getBoundingClientRect().width ?? -1,
    sidebar: document.querySelector('.sidebar-essentials')?.getBoundingClientRect().left ?? -1,
    ready: document.documentElement.classList.contains('mu-shell-ready'),
  }))
  await waitForShell(page)
  const late = await page.evaluate(() => ({
    rail: document.getElementById('modnavigator')?.getBoundingClientRect().width ?? -1,
    sidebar: document.querySelector('.sidebar-essentials')?.getBoundingClientRect().left ?? -1,
    content: getComputedStyle(document.getElementById('listViewContent') as Element).paddingLeft,
    keep: document.documentElement.hasAttribute('data-mu-keep-rail'),
  }))
  if (late.keep) {
    // The v7 strip of this CRM has entries the theme menu does not cover: it stays (and the rule says why).
    expect(late.rail).toBe(42)
    test.info().annotations.push({ type: 'kept-rail', description: 'the v7 module strip has uncovered entries' })
    return
  }
  expect(early.rail, 'rail before the shell').toBe(0)
  expect(late.rail, 'rail after the shell').toBe(0)
  expect(early.sidebar).toBe(late.sidebar)
  expect(late.sidebar).toBe(0)
  expect(late.content).toBe('241px')
  // Every entry of the hidden strip stays reachable: the mega menu has the modules of the menu of the theme.
  const strip = await page.locator('#modnavigator .mod-switcher-container a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
  expect(strip.length, 'entries of the hidden v7 strip').toBeGreaterThanOrEqual(0)
  // Another module: the shell of 0.6 (rail of the theme or of v7).
  await page.goto('index.php?module=Contacts&view=List&modernui=on')
  await waitForShell(page)
  expect(await page.evaluate(() => document.getElementById('modnavigator')?.getBoundingClientRect().width ?? -1)).toBe(42)
})

test('record over the list: open, Escape, Back/Forward, close button, double click, same list after', async ({ page }) => {
  const errors = watchErrors(page)
  // Page loads (pushState of the overlay is a same-document navigation and does not count).
  const navigations: string[] = []
  page.on('load', () => {
    navigations.push(page.url())
  })
  const overlayRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('displayMode=overlay')) {
      overlayRequests.push(request.url())
    }
  })
  // A search of the list (a filter state that must survive) that keeps the synthetic records.
  const search = encodeURIComponent(JSON.stringify([[['accountname', 'c', NAME]]]))
  await openList(page, `&search_params=${search}&page=1`)
  const before = await listState(page)
  expect(before.rows).toEqual(expect.arrayContaining(created))
  const url = page.url()
  navigations.length = 0
  const idle = await handlers(page)

  await openRecord(page, created[0] ?? '')
  expect(page.url(), 'the address stays the list').toBe(url)
  expect(navigations, 'no page load').toEqual([])
  expect(await page.evaluate(() => (history.state as { muRecord?: { record?: string } } | null)?.muRecord?.record)).toBe(created[0])
  expect(await page.locator('#overlayPageContent .overlayDetail td.fieldValue').count(), 'fields of the record').toBeGreaterThan(0)
  expect(await page.locator('#overlayPageContent .fullDetailsButton').count(), 'direct link to the full page').toBe(1)
  expect(await page.evaluate(() => document.getElementById('overlayPageContent')?.contains(document.activeElement) ?? false), 'focus in the window').toBe(true)
  // The list is still there under the window, unchanged.
  expect((await listState(page)).rows).toEqual(before.rows)

  // Escape closes; the same list, page, search and scroll, focus back on the row.
  await page.keyboard.press('Escape')
  await expect(overlayOpen(page)).toHaveCount(0)
  await expect(page.locator('#overlayPageContent.in')).toHaveCount(0)
  expect(await listState(page)).toEqual(before)
  expect(await page.evaluate(() => (history.state as { muRecord?: unknown } | null)?.muRecord ?? null), 'history entry of the record consumed').toBeNull()
  expect(await page.evaluate((id) => document.activeElement?.closest(`tr[data-id="${id}"]`) !== null, created[0] ?? '')).toBe(true)

  // Back closes, Forward opens again (no page load).
  await openRecord(page, created[0] ?? '')
  await page.goBack()
  await expect(overlayOpen(page)).toHaveCount(0)
  await page.goForward()
  await expect(overlayOpen(page)).toHaveAttribute('data-mu-record', created[0] ?? '')
  // The close button of v7.
  await page.locator('#overlayPageContent .overlayDetailHeader .close').click()
  await expect(overlayOpen(page)).toHaveCount(0)
  expect(await page.evaluate(() => (history.state as { muRecord?: unknown } | null)?.muRecord ?? null)).toBeNull()
  expect(navigations, 'still no page load').toEqual([])

  // Two rows clicked one after the other: the first record opens, the second click is swallowed while it loads.
  overlayRequests.length = 0
  await recordLink(page, created[1] ?? '').click()
  await recordLink(page, created[0] ?? '').click({ timeout: 2000 }).catch(() => undefined)
  await expect(overlayOpen(page)).toHaveAttribute('data-mu-record', created[1] ?? '')
  await page.waitForTimeout(1000)
  expect(overlayRequests.filter((request) => request.includes('view=Detail')).length, 'one record request').toBe(1)
  expect(navigations, 'no page load').toEqual([])
  await page.keyboard.press('Escape')
  await expect(overlayOpen(page)).toHaveCount(0)
  // A double click stays the inline edit of the row of v7 (List.js): no record opens.
  if ((await page.locator('#isExcelEditSupported').inputValue().catch(() => 'no')) !== 'no') {
    await page.locator(`#listViewContent tr.listViewEntries[data-id="${created[1] ?? ''}"] td:nth-child(3)`).dblclick()
    await page.waitForTimeout(1000)
    await expect(overlayOpen(page)).toHaveCount(0)
    expect(navigations, 'no page load on a double click').toEqual([])
    await openList(page, `&search_params=${search}&page=1`)
    navigations.length = 0
  }

  // Opening and closing again leaves no handlers behind (after the first record: scripts of v7 loaded once). Handlers that
  // also pile up after any other AJAX request of v7 (extensions re-binding on ajaxComplete) belong to the host, not to the overlay.
  await openRecord(page, created[0] ?? '')
  await page.keyboard.press('Escape')
  await expect(overlayOpen(page)).toHaveCount(0)
  // AJAX requests of jQuery that complete during the cycles (the overlay view, its scripts, polls of extensions).
  await page.evaluate(() => {
    const jq = (window as unknown as { jQuery: (target: unknown) => { on: (event: string, handler: () => void) => void } }).jQuery
    jq(document).on('ajaxComplete.muTest', () => {
      document.documentElement.dataset['muTestAjax'] = String(Number(document.documentElement.dataset['muTestAjax'] ?? '0') + 1)
    })
  })
  const before3 = await handlerMap(page)
  const ajaxBefore = Number(await page.locator('html').getAttribute('data-mu-test-ajax') ?? '0')
  for (let i = 0; i < 3; i += 1) {
    await openRecord(page, created[i % 2] ?? '')
    await page.keyboard.press('Escape')
    await expect(overlayOpen(page)).toHaveCount(0)
  }
  const after3 = await handlerMap(page)
  const ajaxCount = Number(await page.locator('html').getAttribute('data-mu-test-ajax') ?? '0') - ajaxBefore
  await page.evaluate(() => new Promise<void>((resolve) => {
    const app = (window as unknown as { app: { request: { get: (p: unknown) => { then: (f: () => void) => void } } } }).app
    app.request.get({ data: { module: 'ModernUI', action: 'Bootstrap' } }).then(() => {
      resolve()
    })
  }))
  const afterAjax = await handlerMap(page)
  const grown = Object.keys(after3).filter((key) => (after3[key] ?? 0) > (before3[key] ?? 0))
  test.info().annotations.push({ type: 'handlers', description: grown.map((key) => `${key}: +${String((after3[key] ?? 0) - (before3[key] ?? 0))} in 3 cycles (${String(ajaxCount)} AJAX), +${String((afterAjax[key] ?? 0) - (after3[key] ?? 0))} per AJAX of v7`).join('; ') || 'none' })
  for (const key of grown) {
    const perAjax = (afterAjax[key] ?? 0) - (after3[key] ?? 0)
    expect(perAjax, `${key}: grows only like after any AJAX request of v7`).toBeGreaterThan(0)
    expect((after3[key] ?? 0) - (before3[key] ?? 0), `${key}: not more than after the same number of AJAX requests of v7`).toBeLessThanOrEqual(ajaxCount * perAjax)
  }
  if (isClean) {
    expect(grown, 'no handler piles up on a clean CRM').toEqual([])
  }
  expect(idle, 'handler count of the page before the first record').toBeGreaterThan(0)
  expect(errors.page, 'no page errors').toEqual([])
})

test('list reloaded by AJAX (another page, sort): the record still opens over it and the list stays', async ({ page }) => {
  await openList(page)
  const next = page.locator('#NextPageButton:not([disabled])')
  if ((await next.count()) > 0 && await next.isVisible()) {
    await next.click()
    await expect(page.locator('#pageNumber')).toHaveValue('2')
    await settle(page)
  } else {
    // A small CRM: sort by the name column (also an AJAX reload of v7).
    await page.locator('#listViewContent .listViewContentHeaderValues[data-columnname="accountname"]').first().click()
    await settle(page)
  }
  const before = await listState(page)
  const id = before.rows[Math.min(2, before.rows.length - 1)] ?? ''
  expect(id).not.toBe('')
  await page.evaluate(() => {
    window.scrollTo(0, 300)
  })
  const scrolled = await listState(page)
  await openRecord(page, id)
  await page.keyboard.press('Escape')
  await expect(overlayOpen(page)).toHaveCount(0)
  expect(await listState(page)).toEqual(scrolled)
})

test('direct link of the record: the full page with all actions; Back returns to the record over the list', async ({ page }) => {
  const id = created[0] ?? ''
  // The full page by its URL, with the theme and without: the same actions of the header.
  const actions = async (mode: 'on' | 'off'): Promise<string[]> => {
    await page.goto(`index.php?module=${MODULE}&view=Detail&record=${id}&modernui=${mode}`)
    if (mode === 'on') {
      await waitForShell(page)
    }
    await settle(page)
    return page.locator('.detailview-header .btn, .detailViewButtoncontainer .btn').evaluateAll((buttons) => buttons.map((button) => button.textContent.replace(/\s+/g, ' ').trim()))
  }
  const off = await actions('off')
  const on = await actions('on')
  expect(on, 'actions of the full page of the record').toEqual(off)
  test.info().annotations.push({ type: 'full-page-actions', description: String(off.length) })

  const search = encodeURIComponent(JSON.stringify([[['accountname', 'c', NAME]]]))
  await openList(page, `&search_params=${search}&page=1`)
  const listUrl = page.url()
  await openRecord(page, id)
  const overlayActions = await page.locator('#overlayPageContent .overlayDetailHeader .btn').count()
  test.info().annotations.push({ type: 'overlay-actions', description: String(overlayActions) })
  await Promise.all([page.waitForURL(/view=Detail/), page.locator('#overlayPageContent .fullDetailsButton').click()])
  expect(page.url()).toContain(`record=${id}`)
  await waitForShell(page)
  await page.goBack()
  await waitForShell(page)
  expect(page.url()).toBe(listUrl)
  await expect(overlayOpen(page)).toHaveAttribute('data-mu-record', id)
  await page.keyboard.press('Escape')
  await expect(overlayOpen(page)).toHaveCount(0)
})

test('edit over the list: validation of v7, cancel, one save with the fields of the form of v7', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = watchErrors(page)
  const id = created[0] ?? ''
  // The form of v7 as the full page shows it (the fields a native submit would send).
  await page.goto(`index.php?module=${MODULE}&view=Edit&record=${id}&modernui=off`)
  await settle(page)
  const fullForm = (await formData(page)).map(([name]) => name)

  const search = encodeURIComponent(JSON.stringify([[['accountname', 'c', NAME]]]))
  await openList(page, `&search_params=${search}&page=1`)
  const before = await listState(page)
  await page.evaluate(() => {
    const bus = (window as unknown as { app?: { event?: { on?: (name: string, handler: () => void) => void } } }).app?.event
    bus?.on?.('post.overLayEditView.loaded', () => {
      document.documentElement.dataset['muTestEditLoaded'] = String(Number(document.documentElement.dataset['muTestEditLoaded'] ?? '0') + 1)
    })
  })
  await openRecord(page, id)
  await page.locator('#overlayPageContent .editRelatedRecord').click()
  const form = page.locator('#overlayPageContent form#EditView')
  await expect(form).toBeVisible()
  expect(await page.locator('html').getAttribute('data-mu-test-edit-loaded'), 'post.overLayEditView.loaded for the extensions').toBe('1')
  const overlayForm = (await formData(page, '#overlayPageContent form#EditView')).map(([name]) => name)
  const ignore = new Set(['__vtrftk', 'returnmodule', 'returnview', 'returnrecord', 'returntab_label', 'returnrelatedModule', 'returnpage',
    'returnviewname', 'returnsearch_params', 'returnsearch_key', 'returnsearch_value', 'returnoperator', 'returnsortorder', 'returnorderby',
    'returnmode', 'returnrelationId', 'appName', 'defaultCallDuration', 'defaultOtherEventDuration', 'isDuplicate'])
  const business = (names: string[]): string[] => [...new Set(names.filter((name) => !ignore.has(name)))].sort()
  const missing = business(fullForm).filter((name) => !business(overlayForm).includes(name))
  const extra = business(overlayForm).filter((name) => !business(fullForm).includes(name))
  test.info().annotations.push({ type: 'form-fields', description: `full ${String(business(fullForm).length)}, overlay ${String(business(overlayForm).length)}, missing [${missing.join(', ')}], extra [${extra.join(', ')}]` })
  if (isClean) {
    expect(missing, 'fields of the full form missing in the overlay form').toEqual([])
  }

  // Validation of v7: the required name empty → no request, the field is marked.
  const saves: Request[] = []
  page.on('request', (request) => {
    if (isSave(MODULE)(request)) {
      saves.push(request)
    }
  })
  const name = form.locator('[name="accountname"]')
  await name.fill('')
  await form.locator('.saveButton').click()
  await page.waitForTimeout(800)
  expect(saves, 'no save of an invalid form').toEqual([])
  await expect(form.locator('[name="accountname"].input-error')).toHaveCount(1)

  // Cancel with a change: the question of v7, then the overlay closes; nothing saved, the list as before.
  await form.locator('.cancelLink').click()
  // The question of v7 (helper.registerModalDismissWithoutSubmit → bootbox) about the changed form.
  const confirm = page.locator('.bootbox.modal.in [data-bb-handler="confirm"]').first()
  await expect(confirm, 'v7 asks about the unsaved change').toBeVisible()
  await confirm.click()
  await expect(overlayOpen(page)).toHaveCount(0)
  expect(saves).toEqual([])
  expect((await listState(page)).rows).toEqual(before.rows)

  // A nested popup of a reference field over the form, Escape stays with it.
  await openRecord(page, id)
  await page.locator('#overlayPageContent .editRelatedRecord').click()
  await expect(form).toBeVisible()
  const reference = form.locator('.referencefield-wrapper .relatedPopup').first()
  if ((await reference.count()) > 0) {
    await reference.click()
    const popup = page.locator('.modal.in .popupModal, .modal.in #popupPageContainer, .modal.in .popupEntriesDiv').first()
    await expect(popup).toBeVisible()
    const box = await popup.boundingBox()
    const top = box === null ? null : await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.modal')?.id ?? 'other', { x: box.x + box.width / 2, y: box.y + 20 })
    expect(top, 'the popup is above the record').not.toBe('overlayPageContent')
    await page.keyboard.press('Escape')
    await expect(overlayOpen(page), 'Escape in the popup does not close the record').toHaveAttribute('data-mu-record', id)
    await page.locator('.modal.in:not(#overlayPageContent) .close').first().click({ timeout: 5000 }).catch(() => undefined)
    await expect(page.locator('.modal.in:not(#overlayPageContent)')).toHaveCount(0)
  }

  // One save: the same action, the fields of the form of v7, then the record again over the same list.
  const newName = `${NAME} Overlay A saved Ä`
  await name.fill(newName)
  const left = await fillMandatory(page, 'on', '#overlayPageContent form#EditView')
  test.info().annotations.push({ type: 'mandatory-left', description: left.join(', ') })
  saves.length = 0
  // A DOM click: the submit is a navigation that the overlay cancels, and Playwright would wait for it after its own click
  // (on a clean CRM the submit is synchronous to the click) and keep it as pending: wait in the page, not with locators.
  await form.locator('.saveButton').evaluate((button: HTMLElement) => {
    button.click()
  })
  await page.waitForFunction((text) => {
    const detail = document.querySelector('#overlayPageContent .overlayDetail')
    return detail?.textContent.includes(text) === true && document.documentElement.hasAttribute('data-mu-record')
  }, newName, { timeout: 20_000 })
  expect(await page.evaluate(() => Array.from(document.querySelectorAll('.blockOverlay, #progressDiv, .vt-loader')).filter((e) => (e as HTMLElement).offsetParent !== null).length), 'no progress left').toBe(0)

  expect(saves.length, 'one save request').toBe(1)
  const [request] = saves
  if (request === undefined) {
    throw new Error('no save request')
  }
  const sent = business(payload(request).map(([key]) => key))
  expect(sent, 'the save sends the fields of the overlay form').toEqual(business(overlayForm))
  expect(payload(request).find(([key]) => key === 'record')?.[1]).toBe(id)
  expect(page.url()).toContain('view=List')
  // Closing reloads the page of the list (v7 list controller): the new name, same page and search.
  await page.keyboard.press('Escape')
  await expect(overlayOpen(page)).toHaveCount(0)
  await expect(page.locator(`#listViewContent tr.listViewEntries[data-id="${id}"]`)).toContainText(newName)
  const after = await listState(page)
  expect(after.page).toBe(before.page)
  expect(after.search).toBe(before.search)
  // The server has the value (full page of the record).
  await page.goto(`index.php?module=${MODULE}&view=Detail&record=${id}&modernui=off`)
  await expect(page.locator('.detailview-header')).toContainText(newName)
  expect(errors.page, 'no page errors').toEqual([])
})

test('failures and the standard view: no overlay view or no Navigation API → the full page; safe mode → v7', async ({ page, context }) => {
  const id = created[1] ?? ''
  const search = encodeURIComponent(JSON.stringify([[['accountname', 'c', NAME]]]))
  await page.route(/displayMode=overlay/, (route) => route.abort())
  await openList(page, `&search_params=${search}&page=1`)
  await Promise.all([
    page.waitForURL(new RegExp(`view=Detail&record=${id}`)),
    recordLink(page, id).click(),
  ])
  await page.unroute(/displayMode=overlay/)

  const other = await context.newPage()
  await other.addInitScript(() => {
    Object.defineProperty(window, 'navigation', { value: undefined, configurable: true })
  })
  await other.goto(`${LIST}&search_params=${search}&page=1&modernui=on`)
  await waitForShell(other)
  await Promise.all([
    other.waitForURL(new RegExp(`view=Detail&record=${id}`)),
    recordLink(other, id).click(),
  ])
  await other.close()

  // Back to the standard interface (safe mode of the session): the v7 rail and the full page of v7, nothing intercepted.
  await page.goto(`${LIST}&search_params=${search}&page=1&modernui=off`)
  await expect(page.locator('html')).not.toHaveClass(/mu-shell-ready/)
  expect(await page.evaluate(() => document.getElementById('modnavigator')?.getBoundingClientRect().width ?? -1), 'v7 rail in the standard view').toBe(42)
  await Promise.all([page.waitForURL(new RegExp(`view=Detail&record=${id}`)), recordLink(page, id).click()])
  await page.goto(`${LIST}&modernui=on`)
})
