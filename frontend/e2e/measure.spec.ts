/**
 * Cost of the theme against the same CRM without it (stage 04, docs/verification.md; Q8 and Q9 of
 * docs/architecture.md §14): for a few screens, a cold and a warm load in safe mode (modernui=off, no theme
 * resources at all) and with the theme — first contentful paint, DOMContentLoaded, load, the moment the shell is
 * ready, layout shift (CLS), requests and transferred bytes; the size of every theme resource; server time of
 * Bootstrap and its 304 revalidation; whether the tokens stylesheet is served from the browser cache.
 *
 * Only metrics are written, no page content: .local/e2e-reports/<target>/measure-<MU_MEASURE_LABEL>.json.
 * MU_MEASURE_RUNS (default 5) loads per screen and mode.
 *
 * No request interception here (it would switch the HTTP cache of the browser off and spoil the warm loads):
 * requests to other hosts than the CRM are recorded instead, and there must be none.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { crmUrl, reportDir, repoRoot, target } from './env'
import { waitForShell } from './support'

const label = process.env['MU_MEASURE_LABEL'] ?? 'stage04'
const runs = Number.parseInt(process.env['MU_MEASURE_RUNS'] ?? '5', 10)
const screens = ['index.php?module=Home&view=DashBoard', 'index.php?module=Accounts&view=List', 'index.php?module=Contacts&view=List']

interface Load {
  fcp: number | null
  dcl: number
  load: number
  ready: number | null
  cls: number
  requests: number
  transferKb: number
  themeRequests: number
  themeTransferKb: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : Math.round((((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2) * 10) / 10
}

async function measure(page: Page, url: string, theme: boolean): Promise<Load> {
  await page.goto(url)
  if (theme) {
    await waitForShell(page)
  }
  await page.waitForTimeout(400)
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const paint = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint')
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const theme = resources.filter((entry) => entry.name.includes('modules/ModernUI/') || entry.name.includes('module=ModernUI'))
    const kb = (list: PerformanceResourceTiming[]): number => Math.round(list.reduce((sum, entry) => sum + entry.transferSize, 0) / 102.4) / 10
    const marks = (window as unknown as { __muMetrics?: { cls: number; ready: number | null } }).__muMetrics
    return {
      fcp: paint === undefined ? null : Math.round(paint.startTime),
      dcl: Math.round(nav?.domContentLoadedEventEnd ?? 0),
      load: Math.round(nav?.loadEventEnd ?? 0),
      ready: marks?.ready === null || marks?.ready === undefined ? null : Math.round(marks.ready),
      cls: Math.round((marks?.cls ?? 0) * 1000) / 1000,
      requests: resources.length + 1,
      transferKb: kb(resources) + Math.round((nav?.transferSize ?? 0) / 102.4) / 10,
      themeRequests: theme.length,
      themeTransferKb: kb(theme),
    }
  })
}

test('cost of the theme: timings, layout shift, bytes, Bootstrap', async ({ browser }) => {
  test.setTimeout(900_000)
  const report: Record<string, unknown> = { target, label, runs, started: new Date().toISOString() }
  const results: Record<string, Record<string, Load[]>> = {}
  const own = new URL(crmUrl()).host
  const external: string[] = []
  for (const mode of ['standard', 'theme'] as const) {
    for (const cache of ['cold', 'warm'] as const) {
      const context = await browser.newContext({
        storageState: resolve(repoRoot, target === 'dev' ? '.local/e2e-admin-state.json' : `.local/e2e-${target}-admin-state.json`),
        viewport: { width: 1440, height: 900 },
      })
      context.on('request', (request) => {
        if (new URL(request.url()).host !== own) {
          external.push(new URL(request.url()).host)
        }
      })
      await context.addInitScript(() => {
        const metrics = { cls: 0, ready: null as number | null }
        ;(window as unknown as { __muMetrics: typeof metrics }).__muMetrics = metrics
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) {
              metrics.cls += entry.value
            }
          }
        }).observe({ type: 'layout-shift', buffered: true })
        new MutationObserver(() => {
          if (metrics.ready === null && document.documentElement.classList.contains('mu-shell-ready')) {
            metrics.ready = performance.now()
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] })
      })
      const page = await context.newPage()
      await page.goto(mode === 'standard' ? 'index.php?modernui=off' : 'index.php?modernui=on')
      for (const url of screens) {
        const key = `${mode}/${cache}`
        const list = (results[url] ??= {})[key] ??= []
        for (let run = 0; run < runs; run++) {
          if (cache === 'cold') {
            const cdp = await context.newCDPSession(page)
            await cdp.send('Network.clearBrowserCache')
            await cdp.detach()
          } else if (run === 0) {
            await page.goto(url)
          }
          list.push(await measure(page, url, mode === 'theme'))
        }
      }
      await page.goto('index.php?modernui=on')
      await context.close()
    }
  }
  const summary: Record<string, Record<string, Record<string, number | null>>> = {}
  for (const [url, modes] of Object.entries(results)) {
    for (const [key, loads] of Object.entries(modes)) {
      const fields: (keyof Load)[] = ['fcp', 'dcl', 'load', 'ready', 'cls', 'requests', 'transferKb', 'themeRequests', 'themeTransferKb']
      const row: Record<string, number | null> = {}
      for (const field of fields) {
        const values = loads.map((load) => load[field]).filter((value): value is number => typeof value === 'number')
        row[field] = values.length === 0 ? null : median(values)
      }
      ;(summary[url] ??= {})[key] = row
    }
  }
  report['summary'] = summary
  report['samples'] = results

  // Bootstrap: server time (requestStart → responseStart) of fresh answers and of 304 revalidations.
  const context = await browser.newContext({
    storageState: resolve(repoRoot, target === 'dev' ? '.local/e2e-admin-state.json' : `.local/e2e-${target}-admin-state.json`),
  })
  const page = await context.newPage()
  // Twice: the second page shows whether the tokens stylesheet of this settings revision comes from the cache.
  await page.goto('index.php?module=Accounts&view=List')
  await waitForShell(page)
  await page.goto('index.php?module=Accounts&view=List')
  await waitForShell(page)
  const bootstrap = await page.evaluate(async () => {
    const url = new URL('index.php?module=ModernUI&action=Bootstrap', document.baseURI).toString()
    const fresh: number[] = []
    const revalidated: number[] = []
    let etag = ''
    let status304 = 0
    for (let index = 0; index < 10; index++) {
      const started = performance.now()
      const answer = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, cache: 'no-store' })
      etag = answer.headers.get('ETag') ?? ''
      await answer.text()
      fresh.push(performance.now() - started)
      const again = performance.now()
      const second = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest', 'If-None-Match': etag }, cache: 'no-store' })
      if (second.status === 304) {
        status304++
      }
      await second.text()
      revalidated.push(performance.now() - again)
    }
    const tokens = document.querySelector<HTMLLinkElement>('link[href*="action=Tokens"]')
    const entry = tokens === null ? undefined : (performance.getEntriesByName(tokens.href)[0] as PerformanceResourceTiming | undefined)
    return { fresh, revalidated, etag, status304, tokensFromCache: entry === undefined ? null : entry.transferSize === 0 }
  })
  report['bootstrap'] = {
    medianMs: median(bootstrap.fresh.map((value) => Math.round(value * 10) / 10)),
    median304Ms: median(bootstrap.revalidated.map((value) => Math.round(value * 10) / 10)),
    status304: bootstrap.status304,
    etag: bootstrap.etag !== '',
    tokensFromCacheOnRepeat: bootstrap.tokensFromCache,
    freshMs: bootstrap.fresh,
    revalidatedMs: bootstrap.revalidated,
  }

  // Size of every theme resource of a page (decoded and transferred; the server may compress).
  await page.reload()
  await waitForShell(page)
  report['resources'] = await page.evaluate(() => (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
    .filter((entry) => entry.name.includes('modules/ModernUI/') || entry.name.includes('module=ModernUI'))
    .map((entry) => ({
      file: entry.name.replace(/^.*\/(?:dist\/)?/, '').replace(/\?.*$/, '').replace(/[0-9a-f]{12}/g, '…'),
      type: entry.initiatorType,
      decodedKb: Math.round(entry.decodedBodySize / 102.4) / 10,
      transferKb: Math.round(entry.transferSize / 102.4) / 10,
    })))
  await context.close()

  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), `measure-${label}.json`), `${JSON.stringify(report, null, 2)}\n`)
  expect(Object.keys(summary)).toHaveLength(screens.length)
  expect([...new Set(external)], 'requests to other hosts').toEqual([])

  // Budgets of a page with the theme against the same page without it (stage 19, docs/verification.md): medians of the
  // cold loads, the requests and bytes of the theme. Generous enough for a loaded laptop, tight enough to catch a
  // render-blocking regression or a theme that waits for the network.
  const budgets: string[] = []
  for (const [url, modes] of Object.entries(summary)) {
    const standard = modes['standard/cold']
    const theme = modes['theme/cold']
    const warm = modes['theme/warm']
    if (standard === undefined || theme === undefined || warm === undefined) continue
    const over = (name: string, value: number | null | undefined, limit: number): void => {
      if (value !== null && value !== undefined && value > limit) budgets.push(`${url}: ${name} ${String(value)} > ${String(limit)}`)
    }
    over('first contentful paint +ms', (theme['fcp'] ?? 0) - (standard['fcp'] ?? 0), 80)
    over('shell ready after load, ms', (theme['ready'] ?? 0) - (theme['load'] ?? 0), 250)
    const listPage = new URLSearchParams(url.split('?')[1] ?? '').get('view') === 'List'
    over('layout shift', theme['cls'], listPage ? 0.2 : 0.1)
    over('requests of the theme (cold)', theme['themeRequests'], 13)
    over('transfer of the theme (warm), KB', warm['themeTransferKb'], 5)
  }
  expect(budgets, 'budgets of the theme').toEqual([])
})

/**
 * Stage 19: delays of the usual transitions with and without the theme (medians of MU_MEASURE_RUNS): a record from the
 * list (v7: the full page; theme: the window over the list), back to the list, another list, the settings of the CRM.
 * Each ends when the screen can be used: the fields of the record, the rows of the list, the catalog of the settings.
 */
test('transitions: record from the list and back, another list, settings — with and without the theme', async ({ browser }) => {
  test.setTimeout(900_000)
  const link = '#listViewContent tr.listViewEntries[data-id] a[href*="view=Detail"]:not([href*="mode="])'
  const rows = '#listview-table tr.listViewEntries'
  const results: Record<string, Record<string, number[]>> = {}
  for (const mode of ['standard', 'theme'] as const) {
    const context = await browser.newContext({
      storageState: resolve(repoRoot, target === 'dev' ? '.local/e2e-admin-state.json' : `.local/e2e-${target}-admin-state.json`),
      viewport: { width: 1440, height: 900 },
    })
    const page = await context.newPage()
    await page.goto(mode === 'standard' ? 'index.php?modernui=off' : 'index.php?modernui=on')
    const time = async (name: string, action: () => Promise<unknown>): Promise<void> => {
      const started = Date.now()
      await action()
      ;((results[mode] ??= {})[name] ??= []).push(Date.now() - started)
    }
    const listReady = async (): Promise<void> => {
      if (mode === 'theme') await waitForShell(page)
      await page.locator(rows).first().waitFor()
    }
    for (let run = 0; run < runs + 1; run++) {
      await page.goto(screens[1] ?? '')
      await listReady()
      await page.waitForTimeout(300)
      await time('list → record', async () => {
        await page.locator(link).filter({ visible: true }).first().click()
        if (mode === 'theme') {
          await page.locator('#overlayPageContent.in .overlayDetail td.fieldValue').first().waitFor()
        } else {
          await page.waitForURL(/view=Detail/)
          await page.locator('.detailview-content td.fieldValue, #detailView td.fieldValue').first().waitFor()
          await page.waitForLoadState('load')
        }
      })
      await time('record → list', async () => {
        if (mode === 'theme') {
          await page.keyboard.press('Escape')
          await page.locator('html[data-mu-record]').waitFor({ state: 'detached' })
        } else {
          await page.goBack()
          await page.waitForLoadState('load')
        }
        await page.locator(rows).first().waitFor()
      })
      await time('list → another list', async () => {
        await page.goto(screens[2] ?? '')
        await listReady()
      })
      await time('settings of the CRM', async () => {
        await page.goto('index.php?module=Vtiger&parent=Settings&view=Index')
        if (mode === 'theme') await waitForShell(page)
        await page.locator('#accordion, .settingsIndexPage').first().waitFor()
        await page.waitForLoadState('load')
      })
    }
    await page.goto('index.php?modernui=on')
    await context.close()
  }
  // The first run warms the caches of both modes and is left out.
  const medians: Record<string, Record<string, number>> = {}
  for (const [mode, names] of Object.entries(results)) {
    for (const [name, values] of Object.entries(names)) {
      (medians[name] ??= {})[mode] = median(values.slice(1))
    }
  }
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), `transitions-${label}.json`), `${JSON.stringify({ target, runs, warmupSamplesPerMode: 1, medians, samples: results }, null, 2)}\n`)
  // Budgets: the window over the list loads the same native view through AJAX plus its presentation (+250 ms at most), and
  // the way back is immediate, so the round trip record and back must not be slower than with v7; the rest stays within a
  // fixed margin of the same page without the theme.
  const limits: Record<string, number> = { 'list → record': 250, 'record → list': 100, 'list → another list': 250, 'settings of the CRM': 300 }
  const over: string[] = []
  const trip = (mode: string): number => (medians['list → record']?.[mode] ?? 0) + (medians['record → list']?.[mode] ?? 0)
  if (trip('theme') > trip('standard')) {
    over.push(`record and back: ${String(trip('theme'))} ms with the theme, ${String(trip('standard'))} ms without`)
  }
  for (const [name, limit] of Object.entries(limits)) {
    const value = medians[name]
    if (value?.['theme'] !== undefined && value['standard'] !== undefined && value['theme'] > value['standard'] + limit) {
      over.push(`${name}: ${String(value['theme'])} ms with the theme, ${String(value['standard'])} ms without (+${String(limit)} allowed)`)
    }
  }
  expect(over, 'transition budgets').toEqual([])
})
