/**
 * Behaviour of the CRM screens as they are, for comparisons with ModernUI (task baseline): sign-in, menu,
 * Accounts/Contacts/Leads, SalesOrder with line items, related lists, calendar, reports, settings, the test entity
 * module, URLs a restricted user must not open. Records metrics only — HTTP status, timings, number of requests,
 * failed requests, console and page errors, ModernUI resources on the page, the set of app menu modules — into
 * .local/e2e-reports/<target>/baseline-<MU_BASELINE_LABEL>.json. No page text, screenshots or record data are
 * kept: pages of a dev instance may show customer data.
 *
 * MU_BASELINE_LABEL (default "without-theme") names the run; MU_BASELINE_SAFE_MODE=1 opens every page of the
 * administrator with ?modernui=off first (the dev instance, where the module is registered and on for the
 * administrator: the theme resources are then not printed at all).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { adminCredentials, cleanUserCredentials, crmUrl, isClean, reportDir, target, type Credentials } from './env'
import { isolateNetwork, signIn } from './support'

interface ScreenResult {
  id: string
  url: string
  status: number | null
  ok: boolean
  denied: boolean
  ttfbMs: number
  domContentLoadedMs: number
  loadMs: number
  requests: number
  failedRequests: string[]
  consoleErrors: string[]
  pageErrors: string[]
  modernuiResources: number
  checks: Record<string, boolean | number | string>
}

interface Screen {
  id: string
  url: string | ((page: Page) => Promise<string | null>)
  /** Expected to be refused by Vtiger for this user (restricted profile, private record). */
  denied?: boolean
  check?: (page: Page) => Promise<Record<string, boolean | number | string>>
}

const label = process.env['MU_BASELINE_LABEL'] ?? 'without-theme'
const safeMode = process.env['MU_BASELINE_SAFE_MODE'] === '1'
const report: { target: string; label: string; crm: string; started: string; users: Record<string, ScreenResult[]>; appMenu: Record<string, string[]> } = {
  target,
  label,
  crm: crmUrl(),
  started: new Date().toISOString(),
  users: {},
  appMenu: {},
}

/** First record id of a list view (data-id of the first row), null when the list is empty or refused. */
function firstRecord(module: string): (page: Page) => Promise<string | null> {
  return async (page) => {
    await page.goto(`index.php?module=${module}&view=List`)
    const id = await page.locator('tr.listViewEntries[data-id]').first().getAttribute('data-id', { timeout: 10_000 }).catch(() => null)
    return id === null ? null : `index.php?module=${module}&view=Detail&record=${id}`
  }
}

function editOf(module: string): (page: Page) => Promise<string | null> {
  return async (page) => {
    const detail = await firstRecord(module)(page)
    return detail === null ? null : detail.replace('view=Detail', 'view=Edit')
  }
}

/** Line items of the order: rows of the edit form (#row0 is the hidden template) or of the full detail view. */
const lineItems = async (page: Page): Promise<Record<string, number>> => ({
  lineItemRows: (await page.locator('#lineItemTab tr[id^="row"]:not(#row0)').count())
    || Math.max(0, (await page.locator('.lineItemTableDiv table.lineItemsTable').first().locator('tr').count()) - 1),
})

/** The full detail view (line items are not in the summary view of 8.4.0). */
function fullDetailOf(module: string): (page: Page) => Promise<string | null> {
  return async (page) => {
    const detail = await firstRecord(module)(page)
    return detail === null ? null : `${detail}&mode=showDetailViewByMode&requestMode=full`
  }
}

function adminScreens(): Screen[] {
  const screens: Screen[] = [
    { id: 'home', url: 'index.php?module=Home&view=DashBoard' },
    { id: 'accounts-list', url: 'index.php?module=Accounts&view=List', check: async (p) => ({ rows: await p.locator('tr.listViewEntries').count() }) },
    { id: 'accounts-detail', url: firstRecord('Accounts') },
    { id: 'accounts-edit', url: editOf('Accounts'), check: async (p) => ({ form: await p.locator('form#EditView').count() }) },
    { id: 'accounts-related-contacts', url: async (p) => {
      const detail = await firstRecord('Accounts')(p)
      return detail === null ? null : `${detail}&relatedModule=Contacts&mode=showRelatedList`
    } },
    { id: 'contacts-list', url: 'index.php?module=Contacts&view=List' },
    { id: 'contacts-detail', url: firstRecord('Contacts') },
    { id: 'leads-list', url: 'index.php?module=Leads&view=List' },
    { id: 'salesorder-list', url: 'index.php?module=SalesOrder&view=List' },
    { id: 'salesorder-detail', url: fullDetailOf('SalesOrder'), check: lineItems },
    { id: 'salesorder-edit', url: editOf('SalesOrder'), check: lineItems },
    { id: 'calendar', url: 'index.php?module=Calendar&view=Calendar' },
    { id: 'reports-list', url: 'index.php?module=Reports&view=List' },
    { id: 'settings', url: 'index.php?module=Vtiger&parent=Settings&view=Index' },
    { id: 'module-manager', url: 'index.php?module=ModuleManager&parent=Settings&view=List' },
  ]
  if (isClean) {
    screens.push({ id: 'gadgets-list', url: 'index.php?module=Gadgets&view=List' }, { id: 'gadgets-detail', url: firstRecord('Gadgets') })
  }
  return screens
}

/** U: restricted profile of the clean stand — no Leads/Campaigns, private Accounts, no settings. */
function limitedScreens(foreignAccount: string | null): Screen[] {
  return [
    { id: 'home', url: 'index.php?module=Home&view=DashBoard' },
    { id: 'accounts-list', url: 'index.php?module=Accounts&view=List', check: async (p) => ({ rows: await p.locator('tr.listViewEntries').count() }) },
    { id: 'accounts-detail', url: firstRecord('Accounts'), check: async (p) => ({
      annualRevenueShown: (await p.locator('[data-name="annual_revenue"], #Accounts_detailView_fieldValue_annual_revenue').count()) > 0,
    }) },
    { id: 'salesorder-detail', url: fullDetailOf('SalesOrder'), check: lineItems },
    { id: 'gadgets-list', url: 'index.php?module=Gadgets&view=List' },
    { id: 'calendar', url: 'index.php?module=Calendar&view=Calendar' },
    { id: 'denied-leads', url: 'index.php?module=Leads&view=List', denied: true },
    { id: 'denied-campaigns', url: 'index.php?module=Campaigns&view=List', denied: true },
    { id: 'denied-settings', url: 'index.php?module=Vtiger&parent=Settings&view=Index', denied: true },
    { id: 'denied-module-manager', url: 'index.php?module=ModuleManager&parent=Settings&view=List', denied: true },
    ...(foreignAccount === null ? [] : [{ id: 'denied-private-account', url: foreignAccount, denied: true }]),
  ]
}

async function visit(page: Page, screen: Screen): Promise<ScreenResult> {
  const url = typeof screen.url === 'string' ? screen.url : await screen.url(page)
  const result: ScreenResult = {
    id: screen.id, url: url ?? '(no record)', status: null, ok: false, denied: false, ttfbMs: 0, domContentLoadedMs: 0, loadMs: 0,
    requests: 0, failedRequests: [], consoleErrors: [], pageErrors: [], modernuiResources: 0, checks: {},
  }
  if (url === null) {
    return result
  }
  let requests = 0
  const failed: string[] = []
  const onRequest = (): void => {
    requests += 1
  }
  const onResponse = (response: { status: () => number; url: () => string }): void => {
    if (response.status() >= 400) {
      failed.push(`${String(response.status())} ${new URL(response.url()).pathname}`)
    }
  }
  const onFailed = (request: { url: () => string; failure: () => { errorText: string } | null }): void => {
    failed.push(`${request.failure()?.errorText ?? 'failed'} ${new URL(request.url()).pathname}`)
  }
  const onConsole = (message: { type: () => string; text: () => string }): void => {
    if (message.type() === 'error') {
      result.consoleErrors.push(message.text().replace(/record=\d+/g, 'record=N').slice(0, 200))
    }
  }
  const onPageError = (error: Error): void => {
    result.pageErrors.push(error.message.slice(0, 200))
  }
  page.on('request', onRequest)
  page.on('response', onResponse)
  page.on('requestfailed', onFailed)
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 90_000 })
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
    result.status = response?.status() ?? null
    const timing = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      return entry === undefined ? null : { ttfb: entry.responseStart, dcl: entry.domContentLoadedEventEnd, load: entry.loadEventEnd }
    })
    result.ttfbMs = Math.round(timing?.ttfb ?? 0)
    result.domContentLoadedMs = Math.round(timing?.dcl ?? 0)
    result.loadMs = Math.round(timing?.load ?? 0)
    const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 20_000)
    result.denied = /permission denied|not permitted|access denied|LBL_PERMISSION_DENIED/i.test(body)
      || (await page.locator('.permissionDenied, #permissionDenied').count()) > 0
    result.ok = result.status === 200 && (await page.locator('#navbar').count()) > 0
    result.modernuiResources = await page.locator('link[href*="modules/ModernUI/"], script[src*="modules/ModernUI/"]').count()
    if (screen.check !== undefined && !result.denied) {
      result.checks = await screen.check(page)
    }
  } finally {
    page.off('request', onRequest)
    page.off('response', onResponse)
    page.off('requestfailed', onFailed)
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
  }
  result.requests = requests
  result.failedRequests = failed
  return result
}

async function asUser(browser: Browser, credentials: Credentials, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const page = await context.newPage()
  try {
    await signIn(page, credentials)
    await run(page)
  } finally {
    await context.close()
  }
}

async function appMenuModules(page: Page): Promise<string[]> {
  await page.goto('index.php?module=Home&view=DashBoard')
  await page.locator('#appnavigator').click()
  await expect(page.locator('#app-menu')).toBeVisible()
  const hrefs = await page.locator('#app-menu a[href*="module="]').evaluateAll((links) =>
    links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get('module') ?? ''))
  return [...new Set(hrefs.filter((name) => name !== ''))].sort()
}

test.describe.configure({ mode: 'serial' })

test('sign-in page without a session', async ({ browser }) => {
  // Contexts of the test runner inherit "use" of the project: start without the administrator's session.
  const context = await browser.newContext({ baseURL: crmUrl(), storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)))
  const response = await page.goto('index.php')
  await expect(page.locator('#username')).toBeVisible()
  report.users['anonymous'] = [{
    id: 'login', url: 'index.php', status: response?.status() ?? null, ok: true, denied: false, ttfbMs: 0, domContentLoadedMs: 0, loadMs: 0,
    requests: 0, failedRequests: [], consoleErrors: [], pageErrors: errors,
    modernuiResources: await page.locator('link[href*="modules/ModernUI/"], script[src*="modules/ModernUI/"]').count(), checks: {},
  }]
  await context.close()
})

test('administrator: screens of the CRM', async ({ browser }) => {
  test.setTimeout(15 * 60_000)
  let foreignAccount: string | null = null
  await asUser(browser, adminCredentials(), async (page) => {
    if (safeMode) {
      await page.goto('index.php?modernui=off')
    }
    report.appMenu['admin'] = await appMenuModules(page)
    const results: ScreenResult[] = []
    for (const screen of adminScreens()) {
      results.push(await visit(page, screen))
    }
    report.users['admin'] = results
    if (isClean) {
      // A private account of the administrator, for the restricted user.
      await page.goto('index.php?module=Accounts&view=List&search_params=' + encodeURIComponent(JSON.stringify([[['accountname', 'c', 'Ромашка']]])))
      const id = await page.locator('tr.listViewEntries[data-id]').first().getAttribute('data-id', { timeout: 10_000 }).catch(() => null)
      foreignAccount = id === null ? null : `index.php?module=Accounts&view=Detail&record=${id}`
    }
    if (safeMode) {
      await page.goto('index.php?modernui=on')
    }
  })
  if (isClean) {
    await asUser(browser, cleanUserCredentials('limited'), async (page) => {
      report.appMenu['limited'] = await appMenuModules(page)
      const results: ScreenResult[] = []
      for (const screen of limitedScreens(foreignAccount)) {
        results.push(await visit(page, screen))
      }
      report.users['limited'] = results
    })
    await asUser(browser, cleanUserCredentials('viewer'), async (page) => {
      report.appMenu['viewer'] = await appMenuModules(page)
      report.users['viewer'] = [await visit(page, { id: 'accounts-list', url: 'index.php?module=Accounts&view=List',
        check: async (p) => ({ rows: await p.locator('tr.listViewEntries').count() }) })]
    })
  }
})

test.afterAll(() => {
  const dir = reportDir()
  mkdirSync(dir, { recursive: true })
  const file = resolve(dir, `baseline-${label}.json`)
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
  for (const [user, results] of Object.entries(report.users)) {
    for (const r of results) {
      const line = [
        `${user} ${r.id}: HTTP ${r.status === null ? '-' : String(r.status)}${r.denied ? ' denied' : ''}`,
        `load ${String(r.loadMs)} ms`, `${String(r.requests)} req`, `failed ${String(r.failedRequests.length)}`,
        `console ${String(r.consoleErrors.length)}`, `page ${String(r.pageErrors.length)}`, `ModernUI ${String(r.modernuiResources)}`,
      ].join(', ')
      console.log(`[baseline ${target} ${label}] ${line}${Object.keys(r.checks).length > 0 ? ` ${JSON.stringify(r.checks)}` : ''}`)
    }
  }
  for (const [user, modules] of Object.entries(report.appMenu)) {
    console.log(`[baseline ${target} ${label}] app menu of ${user}: ${String(modules.length)} modules`)
  }
  console.log(`[baseline] report: ${file}`)
})
