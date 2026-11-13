/**
 * Stage 19 — repeated work in one document (docs/verification.md «Этап 19»): 40 cycles of list → record over the list →
 * edit → cancel → a related tab → close → Back/Forward → mega menu. After the warm-up and every ten cycles the browser
 * collects garbage and the scenario reads (Chromium DevTools protocol): JS heap, DOM nodes, event listeners of the page
 * and of window/document, the record handlers of the theme, islands, requests of one cycle. Nothing may grow with the
 * number of cycles: subscriptions, requests, nodes, memory. AJAX reloads of the list belong to v7 (its list re-registers
 * handlers on every reload, with and without the theme): a second test compares their growth with the theme off.
 *
 * Read-only for the CRM (the form is cancelled without changes). Metrics only: .local/e2e-reports/<target>/stability.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { reportDir } from './env'
import { waitForShell } from './support'

const LIST = 'index.php?module=Accounts&view=List'
const RECORD_LINK = '#listViewContent tr.listViewEntries[data-id] a[href*="view=Detail"]:not([href*="mode="])'
const CYCLES = Number.parseInt(process.env['MU_STABILITY_CYCLES'] ?? '40', 10)

interface Sample {
  cycle: number
  heapMb: number
  nodes: number
  listeners: number
  windowListeners: number
  documentListeners: number
  recordHandlers: number
  islands: number
  requests: number
  handlers: Record<string, number>
}

async function metrics(cdp: CDPSession): Promise<Record<string, number>> {
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.collectGarbage')
  const { metrics: list } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(list.map((entry) => [entry.name, entry.value]))
}

async function listenersOf(cdp: CDPSession, expression: string): Promise<number> {
  const { result } = await cdp.send('Runtime.evaluate', { expression })
  if (result.objectId === undefined) return -1
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId })
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId })
  return listeners.length
}

/** The window finished opening: its content is there and the focus moved into it (Escape then closes it). */
async function recordOpen(page: Page): Promise<void> {
  await expect(page.locator('#overlayPageContent.in .overlayDetail td.fieldValue').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => document.getElementById('overlayPageContent')?.contains(document.activeElement) ?? false), { timeout: 30_000 }).toBe(true)
}

/** jQuery handlers of the persistent elements by event (the event bus of v7, document, window, body, the page overlay). */
async function census(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const result: Record<string, number> = {}
    const jq = (window as unknown as { jQuery?: { _data?: (element: unknown, name: string) => Record<string, { namespace?: string }[]> | undefined } }).jQuery
    const app = (window as unknown as { app?: { event?: { el?: unknown[] } } }).app
    const add = (label: string, element: unknown): void => {
      if (element === undefined || element === null) return
      for (const [type, list] of Object.entries(jq?._data?.(element, 'events') ?? {})) {
        for (const handler of list) {
          const key = `${label} ${type}${handler.namespace !== undefined && handler.namespace !== '' ? `.${handler.namespace.replace(/\d+/g, '#')}` : ''}`
          result[key] = (result[key] ?? 0) + 1
        }
      }
    }
    add('bus', app?.event?.el?.[0])
    add('document', document)
    add('window', window)
    add('body', document.body)
    add('overlay', document.getElementById('overlayPageContent'))
    return result
  })
}

/** Keys of census() that grow without the theme too (v7 or an extension re-registers them on its AJAX requests). */
const hostGrowing = new Set<string>()

async function closeRecord(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3 && (await page.locator('html[data-mu-record]').count()) > 0; attempt++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  await expect(page.locator('html[data-mu-record]')).toHaveCount(0)
  // The window of v7 fades out and the history entry of the record is consumed: wait like the layout scenario does.
  await expect(page.locator('#overlayPageContent.in')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('.modal-backdrop')).toHaveCount(0, { timeout: 30_000 })
}

async function cycle(page: Page): Promise<void> {
  // Record over the list.
  await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
  await recordOpen(page)
  // Edit in the window, then cancel without changes.
  const edit = page.locator('#overlayPageContent [id$="_detailView_basicAction_LBL_EDIT"]').first()
  if (!(await edit.isVisible())) {
    await page.locator('#overlayPageContent .mu-record-actions-toggle').first().click()
  }
  await edit.click()
  const form = page.locator('#overlayPageContent form#EditView')
  await expect(form).toBeVisible({ timeout: 30_000 })
  await form.locator('.cancelLink').first().click()
  await expect(form).toHaveCount(0, { timeout: 30_000 })
  // A related tab (an AJAX view of the core inside the window), when the record is still open.
  if ((await page.locator('#overlayPageContent.in').count()) > 0) {
    const tab = page.locator('#overlayPageContent .related-tabs [data-label-key="LBL_UPDATES"] a, #overlayPageContent .related-tabs [data-link-key="LBL_RECORD_DETAILS"] a').filter({ visible: true }).first()
    if ((await tab.count()) > 0) {
      await tab.click()
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
    }
  }
  await closeRecord(page)
  // Back reopens the record of the history entry, Forward closes it again (no page load).
  await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
  await recordOpen(page)
  await page.goBack()
  await expect(page.locator('html[data-mu-record]')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('#overlayPageContent.in')).toHaveCount(0, { timeout: 30_000 })
  await page.goForward()
  await expect(page.locator('html[data-mu-record]')).toHaveCount(1, { timeout: 30_000 })
  await recordOpen(page)
  await closeRecord(page)
  // The mega menu, a popup of the theme.
  await page.locator('[data-mu-trigger="mega-menu"]').click()
  await expect(page.locator('[data-mu-panel="mega-menu"]')).toBeVisible()
  await page.keyboard.press('Escape')
}

/** An AJAX reload of the list by v7 itself (sort by the first column, twice). */
async function reloadList(page: Page): Promise<void> {
  for (let sort = 0; sort < 2; sort++) {
    // The visible header is the floating copy of floatThead (the header of the table itself is hidden under it).
    await page.locator('.listViewContentHeaderValues').filter({ visible: true }).first().click()
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
    await expect(page.locator(RECORD_LINK).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
  }
}

test('AJAX reloads of the list grow no more with the theme than without it (v7 itself re-registers its handlers)', async ({ page, context }) => {
  test.setTimeout(900_000)
  const growth: Record<string, Record<string, number>> = {}
  for (const mode of ['off', 'on'] as const) {
    await page.goto(`${LIST}&modernui=${mode}`)
    if (mode === 'on') await waitForShell(page)
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    await reloadList(page)
    const read = async (): Promise<Record<string, number>> => {
      const values = await metrics(cdp)
      return { nodes: values['Nodes'] ?? 0, listeners: values['JSEventListeners'] ?? 0, window: await listenersOf(cdp, 'window'), document: await listenersOf(cdp, 'document') }
    }
    const before = await read()
    const handlersBefore = await census(page)
    for (let index = 0; index < 5; index++) await reloadList(page)
    const after = await read()
    if (mode === 'off') {
      const handlersAfter = await census(page)
      for (const key of Object.keys(handlersAfter)) {
        if ((handlersAfter[key] ?? 0) > (handlersBefore[key] ?? 0)) hostGrowing.add(key)
      }
    }
    growth[mode] = Object.fromEntries(Object.keys(before).map((key) => [key, Math.round(((after[key] ?? 0) - (before[key] ?? 0)) / 5)]))
    await cdp.detach()
  }
  await page.goto(`${LIST}&modernui=on`)
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), 'stability-reload.json'), `${JSON.stringify({ growth, hostGrowing: [...hostGrowing].sort() }, null, 2)}\n`)
  const off = growth['off'] ?? {}
  const on = growth['on'] ?? {}
  for (const key of ['window', 'document']) {
    expect(on[key] ?? 0, `${key} listeners per reload pair, theme vs v7`).toBeLessThanOrEqual((off[key] ?? 0) + 1)
  }
  expect(on['nodes'] ?? 0, 'nodes per reload pair, theme vs v7').toBeLessThanOrEqual((off['nodes'] ?? 0) * 1.1 + 300)
})

test('40 cycles of list, record, edit, related tab, history and menu in one document: nothing grows', async ({ page, context }) => {
  test.setTimeout(1_800_000)
  page.on('dialog', (dialog) => {
    void dialog.dismiss()
  })
  let requests = 0
  page.on('request', () => {
    requests++
  })
  await page.goto(`${LIST}&modernui=on`)
  await waitForShell(page)
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const loads: string[] = []
  page.on('load', () => {
    loads.push(page.url())
  })
  const samples: Sample[] = []
  const sample = async (done: number, cycleRequests: number): Promise<void> => {
    const values = await metrics(cdp)
    samples.push({
      cycle: done,
      heapMb: Math.round((values['JSHeapUsedSize'] ?? 0) / 10485.76) / 100,
      nodes: values['Nodes'] ?? 0,
      listeners: values['JSEventListeners'] ?? 0,
      windowListeners: await listenersOf(cdp, 'window'),
      documentListeners: await listenersOf(cdp, 'document'),
      recordHandlers: Number(await page.locator('html').getAttribute('data-mu-record-handlers') ?? '0'),
      islands: await page.locator('[data-mu-root]').count(),
      requests: cycleRequests,
      handlers: await census(page),
    })
  }
  // Warm-up: the first cycles load scripts of the record views once.
  for (let index = 0; index < 3; index++) {
    await cycle(page)
  }
  await sample(0, 0)
  for (let done = 1; done <= CYCLES; done++) {
    requests = 0
    await cycle(page)
    if (done % 10 === 0) {
      await sample(done, requests)
    }
  }
  await cdp.detach()
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), 'stability.json'), `${JSON.stringify({ cycles: CYCLES, pageLoads: loads.length, samples }, null, 2)}\n`)

  expect(loads, 'everything happens in one document').toEqual([])
  const first = samples[1]
  const last = samples[samples.length - 1]
  expect(first).toBeDefined()
  expect(last).toBeDefined()
  if (first === undefined || last === undefined) return
  // Listeners and handlers stay flat (a leak adds at least one per cycle: +30 over 30 cycles).
  expect(last.windowListeners - first.windowListeners, 'listeners on window').toBeLessThanOrEqual(3)
  expect(last.documentListeners - first.documentListeners, 'listeners on document').toBeLessThanOrEqual(3)
  // jQuery handlers that outlive record views, by event; those the host re-registers on its own AJAX requests without the
  // theme (measured by the reload test before) are reported, not counted.
  const grown = Object.keys({ ...first.handlers, ...last.handlers })
    .filter((key) => (last.handlers[key] ?? 0) > (first.handlers[key] ?? 0) && !hostGrowing.has(key))
    .map((key) => `${key}: ${String(first.handlers[key] ?? 0)} → ${String(last.handlers[key] ?? 0)}`)
  expect(grown, 'jQuery handlers that outlive the record views').toEqual([])
  expect(last.islands, 'islands').toBe(first.islands)
  expect(last.listeners - first.listeners, 'all event listeners of the page').toBeLessThanOrEqual(Math.max(30, first.listeners * 0.05))
  expect(last.nodes, 'DOM nodes').toBeLessThanOrEqual(first.nodes * 1.1 + 200)
  expect(last.heapMb - first.heapMb, 'JS heap after garbage collection, MB').toBeLessThanOrEqual(5)
  const perCycle = samples.slice(1).map((entry) => entry.requests)
  expect(Math.max(...perCycle) - Math.min(...perCycle), 'requests of a cycle').toBeLessThanOrEqual(2)
})

test('hidden BootstrapSwitch finishes its native initializer when a record panel is removed', async ({ page }) => {
  // Observe the actual host plugin's timers, not a reimplementation. This instrumentation belongs only to this test.
  await page.addInitScript(() => {
    const active = new Set<number>()
    Reflect.set(window, '__muSwitchTimers', active)
    const start = window.setInterval.bind(window)
    const stop = window.clearInterval.bind(window)
    Reflect.set(window, 'setInterval', (callback: TimerHandler, delay?: number, ...args: unknown[]): number => {
      const id = start(callback, delay, ...args)
      if (new Error().stack?.includes('/bootstrapswitch/') === true) active.add(id)
      return id
    })
    Reflect.set(window, 'clearInterval', (id?: number): void => { if (id !== undefined) active.delete(id); stop(id) })
  })
  await page.goto(`${LIST}&modernui=on`)
  await waitForShell(page)
  await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
  await recordOpen(page)
  const create = async (hidden: boolean, removeImmediately: boolean): Promise<{ checked: boolean; serialized: string; pending: number }> => page.evaluate(({ hidden, removeImmediately }) => {
    interface JQuery { bootstrapSwitch: (...args: unknown[]) => JQuery; serialize: () => string; remove: () => void }
    const jq = Reflect.get(window, 'jQuery') as (element: unknown) => JQuery
    const root = document.querySelector('#overlayPageContent .overlayDetail')
    if (root === null) throw new Error('missing record')
    const form = document.createElement('form')
    form.id = 'mu-switch-probe'
    form.hidden = hidden
    const input = document.createElement('input')
    input.type = 'checkbox'; input.name = 'switchProbe'; input.value = '1'; input.className = 'bootstrap-switch'
    form.appendChild(input); root.appendChild(form)
    jq(input).bootstrapSwitch({ animate: false }).bootstrapSwitch('state', true, true)
    const result = { checked: input.checked, serialized: jq(form).serialize(), pending: (Reflect.get(window, '__muSwitchTimers') as Set<number>).size }
    // Same synchronous path as a tab's jQuery.html(): instance data disappear before the observer can read them.
    if (removeImmediately) jq(form).remove()
    return result
  }, { hidden, removeImmediately })
  const hidden = await create(true, true)
  expect(hidden.checked).toBe(true)
  expect(hidden.serialized).toBe('switchProbe=1')
  expect(hidden.pending).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__muSwitchTimers') as Set<number>).size)).toBe(0)

  const visible = await create(false, false)
  expect(visible.checked).toBe(true)
  expect(visible.pending).toBe(0)
  await page.locator('#mu-switch-probe .bootstrap-switch-handle-on').click()
  await expect(page.locator('#mu-switch-probe input')).not.toBeChecked()
  await closeRecord(page)
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, '__muSwitchTimers') as Set<number>).size)).toBe(0)
})
