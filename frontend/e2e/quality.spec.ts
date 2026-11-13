/**
 * Stage 19 — quality of the module itself (docs/verification.md «Этап 19»), on the dev instance and the clean stand:
 *
 * - security: every changing action of ModernUI needs POST, the CSRF token of the page and a CRM Referer; refused
 *   requests and errors reveal no paths, SQL or stack traces; module names, records and keys of the views and the
 *   tokens stylesheet cannot reach other files; uploaded logos are re-encoded under a server name (clean stand);
 *   an imported settings file cannot bring markup, scripts or foreign routes;
 * - isolation: one browser signed in by two users in turn, and two users at the same time with different languages —
 *   menu, personal values, tokens and languages never cross (clean stand);
 * - Content-Security-Policy: under a strict policy without 'unsafe-eval' and external hosts the theme works and adds
 *   no violation to those of the CRM itself;
 * - failures: Bootstrap 403, a missing shared chunk or island stylesheet, a missing editor chunk, an expired session —
 *   the standard interface and the administrator pages stay reachable;
 * - accessibility: axe-core (WCAG 2.1 A/AA) finds no new kind of violation with the theme; colour contrast only at the
 *   measured colours of the cloud that design.md §13.5 keeps on purpose; keyboard of the record window and the menu;
 *   reduced motion; German texts fit the controls of the theme.
 *
 * Read-only for the CRM on the dev instance (refused requests change nothing, the personal values of the administrator
 * are restored). Only metrics and rule ids are written: .local/e2e-reports/<target>/quality-*.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { adminCredentials, cleanUserCredentials, crmUrl, isClean, reportDir, stateFile, type CleanUser } from './env'
import { HOME, PREFERENCES, SETTINGS, SETTINGS_FORMS, isolateNetwork, signIn, themeOnPage, waitForShell } from './support'
import { bootstrap, clearPersonal, csrfToken, get, globalScope, menuModules, pngFile, post, saveGlobal, savePersonal } from './settings-api'

test.describe.configure({ mode: 'serial' })

const LIST = 'index.php?module=Accounts&view=List'
const RECORD_LINK = '#listViewContent tr.listViewEntries[data-id] a[href*="view=Detail"]:not([href*="mode="])'
const TRIGGER = '[data-mu-trigger="mega-menu"]'
const PANEL = '[data-mu-panel="mega-menu"]'
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

interface AxeNode {
  target: string[]
  any: { id: string; data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } | null }[]
}
interface AxeViolation {
  id: string
  impact: string | null
  nodes: AxeNode[]
}
declare global {
  interface Window {
    axe?: { run: (context: Document, options: Record<string, unknown>) => Promise<{ violations: AxeViolation[] }> }
    __muCsp?: { directive: string; blocked: string; source: string }[]
  }
}

function report(name: string, data: unknown): void {
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), `quality-${name}.json`), `${JSON.stringify(data, null, 2)}\n`)
}

async function fresh(browser: Browser, user: CleanUser | 'admin', options: { locale?: string; reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: crmUrl(), viewport: { width: 1440, height: 1000 },
    storageState: user === 'admin' && !isClean ? stateFile('admin') : { cookies: [], origins: [] },
    ...(options.reducedMotion === undefined ? {} : { reducedMotion: options.reducedMotion }),
  })
  await isolateNetwork(context)
  const page = await context.newPage()
  if (user !== 'admin' || isClean) {
    await signIn(page, user === 'admin' ? adminCredentials() : cleanUserCredentials(user))
  } else {
    await page.goto(HOME)
  }
  return { context, page }
}

// ---------------------------------------------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------------------------------------------

type Outcome = 'executed' | 'refused'

/** Whether the module ran the action (its redirect with a result, its JSON) or the core refused the request first. */
async function outcome(response: { status(): number; headers(): Record<string, string>; text(): Promise<string> }): Promise<{ kind: Outcome; body: string }> {
  const body = await response.text()
  const location = response.headers()['location'] ?? ''
  if ([301, 302, 303].includes(response.status()) && /[?&]result=/.test(location)) {
    return { kind: 'executed', body }
  }
  try {
    const json = JSON.parse(body) as { success?: unknown; error?: { code?: unknown } | null }
    if (json.success === true || (typeof json.error?.code === 'string' && json.error.code.startsWith('MU_'))) {
      return { kind: 'executed', body }
    }
  } catch {
    // Not JSON: the refusal page of csrf-magic or of the core.
  }
  return { kind: 'refused', body }
}

const LEAK = /\/var\/www|\/home\/|\/data\/|Stack trace|#0 \/|SQLSTATE|mysqli|PearDatabase|\.php on line|Fatal error|Uncaught|Warning: /i

test('page context predicates follow native DOM insertion, class changes and removal', async ({ page }) => {
  await page.goto(LIST)
  await waitForShell(page)
  const id = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      if (!sheet.href?.includes('/ModernUI/resources/dist/')) { continue }
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSMediaRule) || rule.media.mediaText !== 'mu-page-contexts') { continue }
        const data = rule.cssRules[0]
        if (!(data instanceof CSSStyleRule)) { continue }
        const value = data.style.getPropertyValue('--mu-page-contexts').trim()
        const definitions = JSON.parse(decodeURIComponent(value.slice(1, -1))) as [string, string, unknown][]
        const condition = definitions.find((entry) => JSON.stringify(entry[2]) === JSON.stringify(['all', ['query', ':scope .mu-quick-form']]))
        if (condition) { return condition[0] }
      }
    }
    return null
  })
  expect(id).not.toBeNull()
  const active = page.locator(`html[data-mu-context-${String(id)}]`)
  await expect(active).toHaveCount(0)
  try {
    await page.evaluate(() => {
      const probe = document.createElement('form')
      probe.id = 'mu-context-probe'
      probe.hidden = true
      probe.className = 'mu-quick-form'
      document.body.append(probe)
    })
    await expect(active).toHaveCount(1)
    await page.locator('#mu-context-probe').evaluate((element) => { element.classList.remove('mu-quick-form') })
    await expect(active).toHaveCount(0)
    await page.locator('#mu-context-probe').evaluate((element) => { element.classList.add('mu-quick-form') })
    await expect(active).toHaveCount(1)
  } finally {
    await page.locator('#mu-context-probe').evaluate((element) => { element.remove() })
  }
  await expect(active).toHaveCount(0)
})

test('page contexts follow checkbox properties without events and stop when the theme is off', async ({ page }) => {
  await page.goto(LIST)
  await waitForShell(page)
  const id = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      if (!sheet.href?.includes('/ModernUI/resources/dist/')) { continue }
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSMediaRule) || rule.media.mediaText !== 'mu-page-contexts') { continue }
        const data = rule.cssRules[0]
        if (!(data instanceof CSSStyleRule)) { continue }
        const value = data.style.getPropertyValue('--mu-page-contexts').trim()
        const definitions = JSON.parse(decodeURIComponent(value.slice(1, -1))) as [string, string, unknown][]
        const condition = definitions.find((entry) => entry[1] === ':root' && JSON.stringify(entry[2]).includes('.listViewEntriesCheckBox:checked'))
        if (condition) { return condition[0] }
      }
    }
    return null
  })
  expect(id).not.toBeNull()
  const active = page.locator(`html[data-mu-context-${String(id)}]`)
  await expect(active).toHaveCount(0)
  try {
    await page.locator('#listview-table').evaluate((table) => {
      const input = document.createElement('input')
      input.type = 'checkbox'; input.hidden = true; input.id = 'mu-checkbox-probe'; input.className = 'listViewEntriesCheckBox'
      table.append(input)
    })
    await page.locator('#mu-checkbox-probe').evaluate((input) => { (input as HTMLInputElement).checked = true })
    await expect(active).toHaveCount(1)
    await page.locator('#mu-checkbox-probe').evaluate((input) => { (input as HTMLInputElement).checked = false })
    await expect(active).toHaveCount(0)
    await page.locator('html').evaluate((html) => { html.classList.add('mu-off') })
    await page.locator('#mu-checkbox-probe').evaluate((input) => { (input as HTMLInputElement).checked = true })
    await expect(active).toHaveCount(0)
  } finally {
    await page.locator('#mu-checkbox-probe').evaluate((input) => { input.remove() })
  }
})

test('security: every changing action of ModernUI needs POST, the CSRF token of the page and a CRM Referer', async ({ page }) => {
  await page.goto(SETTINGS_FORMS)
  const before = await globalScope(page)
  const personal = (await bootstrap(page))['personal'] as { revision: number; values: Record<string, unknown> }
  const density = before.values['appearance.density'] === 'compact' ? 'comfortable' : 'compact'
  // Each would change something if it ran. AuthPages gets a mode it does not know, so even a wrongly accepted request
  // could not touch the login templates of the CRM.
  const actions: Record<string, string>[] = [
    { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'global', role: '', values: JSON.stringify({ ...before.values, 'appearance.density': density }), baseRevision: String(before.revision), inherit: '0' },
    { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'resetUser', user: '999999' },
    { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'deleteRole', role: 'H999999', baseRevision: '1' },
    { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'previewMenu', values: '{}', locale: 'en-US' },
    { module: 'ModernUI', parent: 'Settings', action: 'Toggle', mode: 'pilotRemoveRole', role: 'H999999' },
    { module: 'ModernUI', parent: 'Settings', action: 'Recovery' },
    { module: 'ModernUI', parent: 'Settings', action: 'AuthPages', mode: 'probe' },
    { module: 'ModernUI', parent: 'Settings', action: 'Logo', mode: 'upload' },
    { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'preview', json: '{}' },
    { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'apply', json: '{}', parts: 'global', fingerprint: '0' },
    { module: 'ModernUI', action: 'Preferences', mode: 'save', values: JSON.stringify({ 'user.standardView': true }) },
    { module: 'ModernUI', action: 'Preferences', mode: 'clear' },
  ]
  const token = await csrfToken(page)
  const own = `${crmUrl()}index.php`
  // The Referer check belongs to the core (Vtiger_Request::validateReferer). Some distributions of 8.4 switch it off by
  // configuration (SalesPlatform: $sp_check_site_url); the CSRF token then stays the protection. Probed with a read.
  const probe = await page.request.get('index.php?module=ModernUI&action=Bootstrap', { headers: { Referer: 'https://attacker.example/page', 'X-Requested-With': 'XMLHttpRequest' } })
  const coreChecksReferer = (await probe.text()).includes('Illegal request')
  const rows: { action: string; variant: string; kind: Outcome }[] = []
  const bodies: string[] = []
  for (const form of actions) {
    const name = `${form['action'] ?? ''}/${form['mode'] ?? ''}`
    const variants: Record<string, () => ReturnType<typeof page.request.get>> = {
      get: () => page.request.get(`index.php?${new URLSearchParams(form).toString()}`, { headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' }, maxRedirects: 0 }),
      'post without token': () => page.request.post('index.php', { form, headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' }, maxRedirects: 0 }),
      'post with a token of another session': () => page.request.post('index.php', { form: { ...form, __vtrftk: 'sid:0123456789abcdef0123456789abcdef01234567,1700000000' }, headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' }, maxRedirects: 0 }),
    }
    if (coreChecksReferer) {
      variants['post, foreign referer'] = () => page.request.post('index.php', { form: { ...form, __vtrftk: token }, headers: { Referer: 'https://attacker.example/page', 'X-Requested-With': 'XMLHttpRequest' }, maxRedirects: 0 })
    }
    for (const [variant, send] of Object.entries(variants)) {
      const result = await outcome(await send())
      rows.push({ action: name, variant, kind: result.kind })
      bodies.push(result.body)
      expect(result.kind, `${name}: ${variant}`).toBe('refused')
    }
  }
  // The classification itself: the same kind of request with the token and the Referer of the CRM is executed.
  const control = await outcome(await page.request.post('index.php', {
    form: { module: 'ModernUI', parent: 'Settings', action: 'Toggle', mode: 'pilotRemoveRole', role: 'H999999', __vtrftk: token },
    headers: { Referer: own }, maxRedirects: 0,
  }))
  expect(control.kind, 'control: a valid request runs').toBe('executed')
  const controlJson = await outcome(await page.request.post('index.php', {
    form: { module: 'ModernUI', action: 'Preferences', mode: 'noop', __vtrftk: token }, headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' }, maxRedirects: 0,
  }))
  expect(controlJson.kind, 'control: a valid JSON request runs').toBe('executed')

  // Nothing changed.
  expect((await globalScope(page)).revision).toBe(before.revision)
  const after = (await bootstrap(page))['personal'] as { revision: number }
  expect(after.revision).toBe(personal.revision)
  for (const body of bodies) {
    expect(body).not.toMatch(LEAK)
  }
  report('csrf', { coreChecksReferer, rows, control: control.kind })
})

test('security: errors and refusals reveal no paths, SQL or stack traces; views keep their own checks', async ({ page }) => {
  await page.goto(HOME)
  const token = await csrfToken(page)
  const own = `${crmUrl()}index.php`
  const deep = `${'{"a":'.repeat(80)}1${'}'.repeat(80)}`
  const checks: { name: string; send: () => Promise<{ status(): number; text(): Promise<string>; headers(): Record<string, string> }> }[] = [
    { name: 'save: broken JSON', send: () => page.request.post('index.php', { form: { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'global', role: '', values: '{"broken', baseRevision: '1', inherit: '0', __vtrftk: token }, headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' } }) },
    { name: 'save: unknown scope', send: () => page.request.post('index.php', { form: { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: '../../user', role: '', values: '{}', baseRevision: '1', inherit: '0', __vtrftk: token }, headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' } }) },
    { name: 'transfer: deep JSON', send: () => page.request.post('index.php', { form: { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'preview', json: deep, __vtrftk: token }, headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' } }) },
    { name: 'transfer: export of unknown parts', send: () => page.request.get('index.php?module=ModernUI&parent=Settings&action=Transfer&mode=export&parts=../../etc', { headers: { Referer: own } }) },
    { name: 'preferences: list instead of object', send: () => page.request.post('index.php', { form: { module: 'ModernUI', action: 'Preferences', mode: 'save', values: '[1,2]', __vtrftk: token }, headers: { Referer: own, 'X-Requested-With': 'XMLHttpRequest' } }) },
    { name: 'record: path as module', send: () => page.request.get('index.php?module=ModernUI&view=Record&sourceModule=../../Users&record=1', { headers: { Referer: own } }) },
    { name: 'record: module without records', send: () => page.request.get('index.php?module=ModernUI&view=Record&sourceModule=ModernUI&record=1', { headers: { Referer: own } }) },
    { name: 'record: SQL as id', send: () => page.request.get(`index.php?module=ModernUI&view=Record&sourceModule=Accounts&record=${encodeURIComponent('1 OR 1=1')}`, { headers: { Referer: own } }) },
    { name: 'form: path as module', send: () => page.request.get('index.php?module=ModernUI&view=Form&formModule=../../config.inc', { headers: { Referer: own } }) },
    { name: 'form: settings module', send: () => page.request.get('index.php?module=ModernUI&view=Form&formModule=Users', { headers: { Referer: own } }) },
  ]
  const rows: { name: string; status: number }[] = []
  for (const check of checks) {
    const response = await check.send()
    const text = await response.text()
    rows.push({ name: check.name, status: response.status() })
    expect(text, check.name).not.toMatch(LEAK)
    expect(text, check.name).not.toMatch(/"success"\s*:\s*true/)
    if (check.name.startsWith('record') || check.name.startsWith('form')) {
      // Refused by the module's own check (the denial page of Vtiger) or earlier by the parameter check of the core (400).
      const refused = response.status() === 400 || /permission denied|LBL_PERMISSION_DENIED|denied\.gif|not permitted/i.test(text)
      expect(refused, `${check.name}: ${String(response.status())}`).toBe(true)
    }
  }
  // The tokens stylesheet: a key that is not the user's own (or a path) gets current values without caching, never a file.
  const tokens = await page.request.get('index.php?module=ModernUI&action=Tokens&r=..%2F..%2F..%2Fetc%2Fpasswd', { headers: { Referer: own } })
  expect(tokens.headers()['content-type']).toMatch(/text\/css/)
  expect(tokens.headers()['cache-control']).toMatch(/no-store/)
  expect(await tokens.text()).not.toMatch(/root:x:|<\?php/)
  report('errors', rows)
})

test('security: the public login page treats its language and error parameters as data', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: crmUrl(), storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const page = await context.newPage()
  for (const query of ['authlang=..%2F..%2F..%2Fetc%2Fpasswd', 'authlang=%3Cscript%3Ealert(1)%3C%2Fscript%3E', 'error=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E', 'screen=recovery&mailStatus=%22%3E%3Cscript%3E']) {
    const response = await page.goto(`index.php?module=Users&view=Login&${query}`)
    expect(response?.status(), query).toBe(200)
    const html = await page.content()
    expect(html, query).not.toMatch(/root:x:|<script>alert|onerror=alert/)
    expect(html, query).not.toMatch(LEAK)
    // The login form, or the recovery form for screen=recovery.
    await expect(page.locator('#username, form[action="forgotPassword.php"]').first(), query).toBeVisible()
  }
  await context.close()
})

test('security: uploaded logos are re-encoded under a server name; SVG, HTML, polyglots and huge images are handled', async ({ page }) => {
  test.skip(!isClean, 'uploads stay for a day in the logo folder of the CRM: clean stand only')
  await page.goto(SETTINGS_FORMS)
  const token = await csrfToken(page)
  const upload = async (name: string, mimeType: string, buffer: Buffer): Promise<{ ok: boolean; code: string; file: string; url: string }> => {
    const response = await page.request.post('index.php', {
      multipart: { module: 'ModernUI', parent: 'Settings', action: 'Logo', mode: 'upload', __vtrftk: token, logo: { name, mimeType, buffer } },
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${crmUrl()}index.php` },
    })
    const json = JSON.parse(await response.text()) as { success: boolean; result?: { file?: string; url?: string }; error?: { code?: string } }
    return { ok: json.success, code: json.error?.code ?? '', file: json.result?.file ?? '', url: json.result?.url ?? '' }
  }
  const php = Buffer.from('<?php echo "mu-polyglot-" . (6 * 7); ?>')
  // A valid image with PHP appended after its end: decoded and re-encoded, the payload does not survive.
  const polyglot = Buffer.concat([await pngFile(32, 32, [9, 99, 199]), php])
  const cases: { name: string; mime: string; buffer: Buffer; expect: string }[] = [
    { name: 'logo.svg', mime: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), expect: 'MU_LOGO_FORMAT' },
    { name: 'logo.png', mime: 'image/png', buffer: Buffer.from('<html><script>alert(1)</script></html>'), expect: 'MU_LOGO_FORMAT' },
    { name: 'shell.php', mime: 'application/x-php', buffer: php, expect: 'MU_LOGO_FORMAT' },
    { name: 'wide.png', mime: 'image/png', buffer: await pngFile(5000, 16, [20, 40, 60]), expect: 'MU_LOGO_DIMENSIONS' },
    { name: 'tiny.png', mime: 'image/png', buffer: await pngFile(8, 8, [20, 40, 60]), expect: 'MU_LOGO_DIMENSIONS' },
  ]
  for (const item of cases) {
    const result = await upload(item.name, item.mime, item.buffer)
    expect(result.ok, item.name).toBe(false)
    expect(result.code, item.name).toBe(item.expect)
  }
  for (const [name, mime, buffer] of [['../../../polyglot.php', 'image/gif', polyglot], ['shell.php', 'application/x-php', await pngFile(32, 32, [1, 2, 3])]] as const) {
    const stored = await upload(name, mime, buffer)
    expect(stored.ok, name).toBe(true)
    expect(stored.file, name).toMatch(/^modernui_[0-9a-f]{40}\.png$/)
    const image = await page.request.get(stored.url)
    expect(image.status(), name).toBe(200)
    expect(image.headers()['content-type'], name).toMatch(/image\/png/)
    const bytes = await image.body()
    expect(bytes.subarray(0, 8).toString('hex'), name).toBe('89504e470d0a1a0a')
    expect(bytes.includes(Buffer.from('<?php')), name).toBe(false)
    expect(bytes.includes(Buffer.from('mu-polyglot')), name).toBe(false)
  }
})

test('security: an imported file cannot bring markup, scripts, foreign routes or custom CSS; the report names them', async ({ page }) => {
  await page.goto(SETTINGS_FORMS)
  const exported = await page.request.get('index.php?module=ModernUI&parent=Settings&action=Transfer&mode=export&parts=global', { headers: { Referer: `${crmUrl()}index.php` } })
  const file = JSON.parse(await exported.text()) as { global: Record<string, unknown> }
  file.global['theme'] = { ...(file.global['theme'] as Record<string, unknown> | undefined), customCss: 'body{display:none}' }
  file.global['appearance'] = { primaryColor: 'javascript:alert(1)', background: '#ffffff' }
  file.global['branding'] = { logo: '../../config.inc.php', title: { 'en-US': '<img src=x onerror=alert(1)>' } }
  file.global['navigation'] = { groups: [{ id: 'g', label: { '*': '<b>x</b>' }, items: [{ type: 'route', id: 'r', label: { '*': 'X' }, route: { module: 'Leads', view: 'List', params: { href: 'javascript:alert(1)' } } }] }] }
  const token = await csrfToken(page)
  const preview = async (json: string): Promise<{ ok: boolean; code: string; invalid: string[] }> => {
    const response = await page.request.post('index.php', {
      form: { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'preview', json, __vtrftk: token },
      headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${crmUrl()}index.php` },
    })
    const body = JSON.parse(await response.text()) as { success: boolean; result?: { report?: { invalid?: { path: string }[] } }; error?: { code?: string } }
    return { ok: body.success, code: body.error?.code ?? '', invalid: (body.result?.report?.invalid ?? []).map((entry) => entry.path) }
  }
  const result = await preview(JSON.stringify(file))
  expect(result.ok).toBe(true)
  for (const path of ['theme.customCss', 'appearance.primaryColor']) {
    expect(result.invalid.join(' '), path).toContain(path)
  }
  // A logo is never part of a transfer (docs/settings.md §9): a path in the file is ignored, not applied.
  expect(result.invalid.join(' ')).not.toContain('branding.logo')
  expect(result.invalid.some((path) => path.startsWith('branding.title'))).toBe(true)
  expect(result.invalid.some((path) => path.startsWith('navigation.groups'))).toBe(true)
  expect((await preview(`${'['.repeat(100)}${']'.repeat(100)}`)).code).toBe('MU_IMPORT_FORMAT')
  expect((await preview(JSON.stringify({ ...file, __proto__: { polluted: true }, extra: 1 }))).code).toBe('MU_IMPORT_FORMAT')
  expect((await preview(JSON.stringify({ ...file, filler: 'x'.repeat(300 * 1024) }))).code).toMatch(/MU_IMPORT_(TOO_LARGE|FORMAT)/)
})

// ---------------------------------------------------------------------------------------------------------------
// Isolation between users
// ---------------------------------------------------------------------------------------------------------------

test('isolation: one browser signed in by two users in turn — menu, personal values, tokens and drafts never cross', async ({ browser }) => {
  test.skip(!isClean, 'needs the synthetic users of the clean stand')
  const { context, page } = await fresh(browser, 'admin')
  const original = await globalScope(page)
  expect((await saveGlobal(page, { ...original.values, 'theme.mode': 'all' }, original.revision)).ok).toBe(true)
  try {
    const adminPersonal = (await bootstrap(page))['personal'] as { values: Record<string, unknown> }
    expect((await savePersonal(page, { locale: 'de-DE', 'navigation.favorites': ['Leads', 'Accounts'] })).ok).toBe(true)
    await page.goto(LIST)
    await waitForShell(page)
    const adminTokens = (await page.locator('link[href*="action=Tokens"]').getAttribute('href')) ?? ''
    const adminData = await bootstrap(page)
    expect((adminData['locale'] as { effective: string }).effective).toBe('de-DE')
    // A draft of the settings editor of the administrator, kept by this tab.
    await page.evaluate(() => { sessionStorage.setItem('modernui.settings.draft.1', '{"v":1}') })

    await page.goto('index.php?module=Users&action=Logout')
    await signIn(page, cleanUserCredentials('limited'))
    await page.goto(LIST)
    await waitForShell(page)
    const limited = await bootstrap(page)
    expect((limited['user'] as { isAdmin: boolean }).isAdmin).toBe(false)
    expect((limited['locale'] as { effective: string }).effective).not.toBe('de-DE')
    expect(JSON.stringify((limited['personal'] as { values: unknown }).values)).not.toContain('Leads')
    expect(menuModules(limited)).not.toContain('Leads')
    const system = ((limited['menu'] as { system: { id: string }[] }).system).map((entry) => entry.id)
    expect(system).not.toContain('crmSettings')
    expect(system).not.toContain('moduleSettings')
    expect((await page.locator('link[href*="action=Tokens"]').getAttribute('href')) ?? '').not.toBe(adminTokens)
    // The menu on the page is the limited user's: no module of the administrator, no favorites of the administrator.
    await page.locator(TRIGGER).click()
    await expect(page.locator(PANEL)).toBeVisible()
    expect(await page.locator(`${PANEL} a[href*="module=Leads&"]`).count()).toBe(0)
    await page.keyboard.press('Escape')
    expect(await page.locator('[data-mu-root="favorites"] a[href*="module=Leads&"]').count()).toBe(0)
    // The settings editor of the administrator (and its draft) is not reachable.
    await page.goto(SETTINGS)
    await expect(page.locator('.mu-editor')).toHaveCount(0)

    await page.goto('index.php?module=Users&action=Logout')
    await signIn(page, adminCredentials())
    const again = await bootstrap(page)
    expect((again['locale'] as { effective: string }).effective).toBe('de-DE')
    expect(((again['menu'] as { favorites: { id: string }[] }).favorites).map((item) => item.id)).toEqual(['m:Leads', 'm:Accounts'])
    await clearPersonal(page)
    if (Object.keys(adminPersonal.values).length > 0) {
      expect((await savePersonal(page, adminPersonal.values)).ok).toBe(true)
    }
  } finally {
    const current = await globalScope(page)
    expect((await saveGlobal(page, original.values, current.revision)).ok).toBe(true)
    await context.close()
  }
})

test('isolation: two users at the same time with different languages and hidden modules', async ({ browser }) => {
  test.skip(!isClean, 'needs the synthetic users of the clean stand')
  const admin = await fresh(browser, 'admin')
  const limited = await fresh(browser, 'limited')
  const original = await globalScope(admin.page)
  try {
    expect((await saveGlobal(admin.page, { ...original.values, 'theme.mode': 'all', 'navigation.hidden': ['Contacts'] }, original.revision)).ok).toBe(true)
    expect((await savePersonal(admin.page, { locale: 'de-DE' })).ok).toBe(true)
    await limited.page.goto(HOME)
    expect((await savePersonal(limited.page, { locale: 'ru-RU' })).ok).toBe(true)
    const [a, b] = await Promise.all([bootstrap(admin.page), bootstrap(limited.page)])
    expect((a['locale'] as { effective: string }).effective).toBe('de-DE')
    expect((b['locale'] as { effective: string }).effective).toBe('ru-RU')
    for (const data of [a, b]) {
      expect(menuModules(data)).not.toContain('Contacts')
    }
    await limited.page.goto(LIST)
    await waitForShell(limited.page)
    await limited.page.locator(TRIGGER).click()
    await expect(limited.page.locator(PANEL)).toBeVisible()
    expect(await limited.page.locator(`${PANEL} a[href*="module=Contacts&"]`).count()).toBe(0)
    await expect(limited.page.locator(PANEL)).toContainText(/[а-яё]/i)
    // The preview of a menu and the settings data are for administrators only.
    expect((await post(limited.page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'previewMenu', values: '{"navigation.hidden":[]}', locale: 'ru-RU' })).ok).toBe(false)
    expect((await get(limited.page, { module: 'ModernUI', parent: 'Settings', action: 'Data' })).ok).toBe(false)
  } finally {
    await clearPersonal(admin.page)
    await clearPersonal(limited.page)
    const current = await globalScope(admin.page)
    expect((await saveGlobal(admin.page, original.values, current.revision)).ok).toBe(true)
    await admin.context.close()
    await limited.context.close()
  }
})

// ---------------------------------------------------------------------------------------------------------------
// Content-Security-Policy
// ---------------------------------------------------------------------------------------------------------------

/** What a careful administrator could put in front of Vtiger 8.4: v7 itself needs inline scripts and styles. */
const POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
  + "font-src 'self' data:; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; "
  + "form-action 'self'; frame-ancestors 'self'"

test('CSP: under a strict policy without unsafe-eval and external hosts the theme works and adds no violation', async () => {
  const own = new URL(crmUrl()).host
  // The policy comes with documents the scenario fulfils itself; Chromium treats such documents as public and its Local
  // Network Access checks would block their subresources on a loopback host name. Test browser only, CSP is untouched.
  const browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults'] })
  const run = async (theme: boolean): Promise<{ violations: string[]; ready: boolean[] }> => {
    const { context, page } = await fresh(browser, 'admin')
    await page.goto(theme ? 'index.php?modernui=on' : 'index.php?modernui=off')
    await context.route((url) => url.host === own, async (route) => {
      if (route.request().resourceType() !== 'document') {
        await route.fallback()
        return
      }
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': POLICY } })
    })
    await context.addInitScript(() => {
      window.__muCsp = []
      document.addEventListener('securitypolicyviolation', (event) => {
        window.__muCsp?.push({ directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile })
      }, true)
    })
    const violations: string[] = []
    const ready: boolean[] = []
    const collect = async (): Promise<void> => {
      const list = await page.evaluate(() => window.__muCsp ?? [])
      for (const entry of list) {
        violations.push(`${entry.directive} ${entry.blocked.replace(/\?.*$/, '')} ${entry.source.replace(/^.*\/(layouts|libraries|resources|modules)\//, '$1/').replace(/\?.*$/, '')}`)
      }
    }
    for (const url of [LIST, 'index.php?module=Contacts&view=Edit', 'index.php?module=Calendar&view=Calendar', SETTINGS, PREFERENCES]) {
      await page.goto(url)
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
      if (theme && url === LIST) {
        await waitForShell(page)
        ready.push(await page.evaluate(() => document.documentElement.classList.contains('mu-shell-ready')))
        await page.locator(TRIGGER).click()
        await expect(page.locator(PANEL)).toBeVisible()
        await page.keyboard.press('Escape')
        await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
        await expect(page.locator('#overlayPageContent.in .overlayDetail')).toBeVisible({ timeout: 30_000 })
        await page.waitForTimeout(800)
      }
      await page.waitForTimeout(500)
      await collect()
    }
    // The same native AJAX view in both modes: the Details tab of a full record page (jQuery inserts its HTML).
    await page.goto(LIST)
    const record = await page.locator('#listViewContent tr.listViewEntries[data-id]').first().getAttribute('data-id')
    await page.goto(`index.php?module=Accounts&view=Detail&record=${record ?? ''}`)
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
    const details = page.locator('.related-tabs [data-link-key="LBL_RECORD_DETAILS"] a').first()
    if (await details.isVisible()) {
      await details.click()
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
    }
    await page.waitForTimeout(500)
    await collect()
    await page.goto('index.php?modernui=on')
    await context.close()
    return { violations: [...new Set(violations)].sort(), ready }
  }
  const off = await run(false)
  const on = await run(true)
  await browser.close()
  expect(on.ready).toEqual([true])
  const added = on.violations.filter((entry) => !off.violations.includes(entry))
  const ofTheme = on.violations.filter((entry) => /ModernUI|modernui|mu-/.test(entry))
  report('csp', { policy: POLICY, off: off.violations, on: on.violations, added, ofTheme })
  expect(ofTheme, 'violations caused by resources of the theme').toEqual([])
  expect(added, 'violations that exist only with the theme').toEqual([])
})

// ---------------------------------------------------------------------------------------------------------------
// Failures and recovery
// ---------------------------------------------------------------------------------------------------------------

test('failures: Bootstrap 403, a missing shared chunk or island stylesheet keep a working standard page', async ({ page }) => {
  const cases: { name: string; match: (url: URL) => boolean; status: number | 'abort' }[] = [
    { name: 'bootstrap 403', match: (url) => url.searchParams.get('module') === 'ModernUI' && url.searchParams.get('action') === 'Bootstrap', status: 403 },
    { name: 'shared chunk', match: (url) => /\/dist\/assets\/common-[^/]+\.js$/.test(url.pathname), status: 'abort' },
    { name: 'island stylesheet', match: (url) => /\/dist\/assets\/common-[^/]+\.css$/.test(url.pathname), status: 404 },
  ]
  const outcomes: Record<string, string> = {}
  for (const failure of cases) {
    await page.route(failure.match, async (route) => {
      await (failure.status === 'abort' ? route.abort() : route.fulfill({ status: failure.status, contentType: 'text/html', body: '<html><body>error</body></html>' }))
    })
    await page.goto(LIST)
    await waitForShell(page)
    const state = await themeOnPage(page)
    outcomes[failure.name] = state.ready ? 'ready' : `failed: ${state.failed ?? ''}`
    if (!state.ready) {
      expect(state.failed, failure.name).not.toBeNull()
      // The standard header and app menu of v7 work.
      await page.locator('#appnavigator').click()
      await expect(page.locator('#app-menu'), failure.name).toBeVisible()
      await page.keyboard.press('Escape')
    }
    // The list itself works and a record opens (over the list or as the full page of v7).
    await expect(page.locator('#listview-table'), failure.name).toBeVisible()
    await Promise.all([
      page.waitForFunction(() => document.querySelector('#overlayPageContent.in .overlayDetail') !== null || location.href.includes('view=Detail'), undefined, { timeout: 30_000 }),
      page.locator(RECORD_LINK).filter({ visible: true }).first().click(),
    ])
    await page.unroute(failure.match)
  }
  report('failures', outcomes)
  // A refused configuration or a missing chunk never leaves a half-mounted shell.
  expect(outcomes['bootstrap 403']).toMatch(/^failed/)
  expect(outcomes['shared chunk']).toMatch(/^failed/)
})

const EDITOR_CHUNK = /\/dist\/assets\/(?:editor|settings)-[^/]+\.js$/

test('failures: a missing editor chunk leaves the administrator the server page of ModernUI', async ({ page }) => {
  await page.route((url) => EDITOR_CHUNK.test(url.pathname), (route) => route.abort())
  await page.goto(SETTINGS)
  await expect(page.locator('table.modernui-status')).toBeVisible({ timeout: 30_000 })
  // The switches and the recovery of the server page are real forms with the CSRF token.
  expect(await page.locator('form.modernui-inline-form input[name="__vtrftk"]').count()).toBeGreaterThan(0)
  await page.unroute((url) => EDITOR_CHUNK.test(url.pathname))
  await page.goto(SETTINGS_FORMS)
  await expect(page.locator('table.modernui-status')).toBeVisible()
})

test('failures: an expired session ends on the login page, never on an empty or stuck screen', async ({ browser }) => {
  const { context, page } = await fresh(browser, 'admin')
  await page.goto(LIST)
  await waitForShell(page)
  await context.clearCookies()
  await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
  await page.waitForTimeout(3000)
  // Either the window shows the login of the CRM or the page went to it; nothing is left half-open.
  const state = await page.evaluate(() => ({
    login: document.querySelector('#username, input[name="username"]') !== null,
    overlayOpen: document.querySelector('#overlayPageContent.in') !== null,
    bodyText: document.body.innerText.trim().length,
  }))
  if (!state.login) {
    await page.reload()
  }
  await expect(page.locator('#username, input[name="username"]').first()).toBeVisible({ timeout: 30_000 })
  expect(state.bodyText).toBeGreaterThan(0)
  await context.close()
})

// ---------------------------------------------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------------------------------------------

/** Measured colours of the cloud that design.md §13.5 keeps on purpose (ratios 2.9–4.3 against white or the page grey). */
const CLOUD_COLOURS = ['#3978fe', '#7b7f85', '#8e9093', '#e55907', '#f85c75', '#5897fb', '#237afe', '#43b576', '#0065ff']

interface AxeSummary { rules: Record<string, number>; targets: Record<string, string[]>; own: string[]; contrast: string[] }

async function axe(page: Page): Promise<AxeSummary> {
  await page.addScriptTag({ path: AXE })
  const violations = await page.evaluate(async () => {
    const result = await window.axe?.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
    return result?.violations ?? []
  })
  const summary: AxeSummary = { rules: {}, targets: {}, own: [], contrast: [] }
  for (const violation of violations) {
    if (violation.impact !== 'serious' && violation.impact !== 'critical') continue
    summary.rules[violation.id] = violation.nodes.length
    summary.targets[violation.id] = violation.nodes.slice(0, 5).map((node) => node.target.join(' ').slice(0, 160))
    for (const node of violation.nodes) {
      const target = node.target.join(' ')
      if (violation.id === 'color-contrast') {
        const data = node.any.find((check) => check.id === 'color-contrast')?.data
        summary.contrast.push(`${data?.fgColor ?? '?'} on ${data?.bgColor ?? '?'} ${String(data?.contrastRatio ?? '?')}`)
      } else if (/(^|[\s.#[])(mu-|data-mu)/.test(target)) {
        summary.own.push(`${violation.id}: ${target}`)
      }
    }
  }
  return summary
}

test('accessibility: axe-core finds no new kind of violation with the theme; contrast only at the cloud colours', async ({ browser }) => {
  const screens: { id: string; url: string; open?: (page: Page) => Promise<void>; compare: string[] }[] = [
    { id: 'list', url: LIST, compare: ['list'] },
    { id: 'record', url: LIST, open: openRecordFromList, compare: ['list', 'account'] },
    { id: 'account', url: 'ACCOUNT', compare: ['account'] },
    { id: 'menu', url: 'index.php?module=Contacts&view=List', open: openMenu, compare: ['contacts'] },
    { id: 'contacts', url: 'index.php?module=Contacts&view=List', compare: ['contacts'] },
    { id: 'detail', url: 'DETAIL', compare: ['detail'] },
    { id: 'edit', url: 'index.php?module=Contacts&view=Edit', compare: ['edit'] },
    { id: 'settings', url: 'index.php?module=Vtiger&parent=Settings&view=Index', compare: ['settings'] },
    { id: 'calendar', url: 'index.php?module=Calendar&view=Calendar', compare: ['calendar'] },
    { id: 'modernui', url: SETTINGS, compare: [] },
    { id: 'preferences', url: PREFERENCES, compare: [] },
  ]
  const { context, page } = await fresh(browser, 'admin')
  await page.goto('index.php?module=Contacts&view=List')
  const contact = await page.locator('#listViewContent tr.listViewEntries[data-id]').first().getAttribute('data-id')
  await page.goto(LIST)
  const account = await page.locator('#listViewContent tr.listViewEntries[data-id]').first().getAttribute('data-id')
  const results: Record<string, AxeSummary> = {}
  for (const theme of [false, true]) {
    await page.goto(theme ? 'index.php?modernui=on' : 'index.php?modernui=off')
    for (const screen of screens) {
      if (!theme && screen.open !== undefined) continue
      await page.goto(screen.url === 'DETAIL' ? `index.php?module=Contacts&view=Detail&record=${contact ?? ''}`
        : screen.url === 'ACCOUNT' ? `index.php?module=Accounts&view=Detail&record=${account ?? ''}` : screen.url)
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined)
      if (theme) await waitForShell(page)
      if (screen.open !== undefined) await screen.open(page)
      await page.waitForTimeout(500)
      results[`${theme ? 'on' : 'off'}/${screen.id}`] = await axe(page)
    }
  }
  await page.goto('index.php?modernui=on')
  await context.close()

  const added: string[] = []
  const contrast: string[] = []
  const own: string[] = []
  for (const screen of screens) {
    const on = results[`on/${screen.id}`]
    if (on === undefined) continue
    own.push(...on.own.map((entry) => `${screen.id}: ${entry}`))
    for (const [rule, count] of Object.entries(on.rules)) {
      if (rule === 'color-contrast') continue
      // A record over the list has both on the page: the list and the native record view.
      const before = screen.compare.reduce((sum, id) => sum + (results[`off/${id}`]?.rules[rule] ?? 0), 0)
      if (screen.compare.length > 0 && count > before) added.push(`${screen.id}: ${rule} ${String(before)} → ${String(count)}`)
    }
    for (const pair of on.contrast) {
      if (!CLOUD_COLOURS.some((colour) => pair.includes(colour))) contrast.push(`${screen.id}: ${pair}`)
    }
  }
  report('axe', { results, added, contrast, own })
  expect(own, 'violations inside the elements of the theme').toEqual([])
  expect(added, 'rules violated more often with the theme').toEqual([])
  expect(contrast, 'contrast below AA at colours that are not the measured cloud palette').toEqual([])
})

async function openRecordFromList(page: Page): Promise<void> {
  await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
  await expect(page.locator('#overlayPageContent.in .overlayDetail')).toBeVisible({ timeout: 30_000 })
}

async function openMenu(page: Page): Promise<void> {
  await page.locator(TRIGGER).click()
  await expect(page.locator(PANEL)).toBeVisible()
}

test('keyboard: the record window and the menu — Enter opens, focus inside, Escape closes and returns focus', async ({ page }) => {
  await page.goto(LIST)
  await waitForShell(page)
  const link = page.locator(RECORD_LINK).filter({ visible: true }).first()
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#overlayPageContent.in .overlayDetail')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => document.getElementById('overlayPageContent')?.contains(document.activeElement) ?? false)).toBe(true)
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press('Tab')
  }
  expect(await page.evaluate(() => document.getElementById('overlayPageContent')?.contains(document.activeElement) ?? false), 'Tab stays in the window').toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('#overlayPageContent.in')).toHaveCount(0)
  await expect.poll(() => link.evaluate((element) => element === document.activeElement || element.closest('tr')?.contains(document.activeElement) === true)).toBe(true)

  const trigger = page.locator(TRIGGER)
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(PANEL)).toBeVisible()
  await expect(page.locator(`${PANEL} [data-mu-field="menu-search"]`)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator(PANEL)).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('reduced motion: the theme does not move when the person asked for it', async ({ browser }) => {
  const durations = async (preference: 'reduce' | 'no-preference'): Promise<number> => {
    const { context, page } = await fresh(browser, 'admin', { reducedMotion: preference })
    await page.goto(LIST)
    await waitForShell(page)
    await openMenu(page)
    const longest = await page.evaluate(() => {
      let max = 0
      for (const element of document.querySelectorAll<HTMLElement>('[data-mu-root] *, [data-mu-panel] *, [class*="mu-"]')) {
        const style = getComputedStyle(element)
        for (const value of [...style.transitionDuration.split(','), ...style.animationDuration.split(',')]) {
          max = Math.max(max, Number.parseFloat(value) || 0)
        }
      }
      return max
    })
    await context.close()
    return longest
  }
  expect(await durations('no-preference'), 'the theme does animate by default (the check is not empty)').toBeGreaterThan(0)
  expect(await durations('reduce')).toBe(0)
})

test('German: the texts of the theme fit their buttons, tabs and menu entries at 1440, 1024 and 412 px', async ({ browser }) => {
  const { context, page } = await fresh(browser, 'admin')
  const before = (await bootstrap(page))['personal'] as { values: Record<string, unknown> }
  expect((await savePersonal(page, { locale: 'de-DE' })).ok).toBe(true)
  const clipped: string[] = []
  try {
    for (const width of [1440, 1024, 412]) {
      await page.setViewportSize({ width, height: width === 412 ? 915 : 900 })
      await page.goto(LIST)
      await waitForShell(page)
      await openMenu(page)
      clipped.push(...(await page.evaluate((viewport) => {
        const found: string[] = []
        const selector = '[data-mu-root] button, [data-mu-root] a, [data-mu-root] [role="tab"], [data-mu-panel] button, [data-mu-panel] a, .mu-list-controls button'
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0 || getComputedStyle(element).visibility === 'hidden') continue
          const style = getComputedStyle(element)
          const ellipsis = style.textOverflow === 'ellipsis' || [...element.querySelectorAll<HTMLElement>('*')].some((child) => getComputedStyle(child).textOverflow === 'ellipsis')
          const overflow = element.scrollWidth > element.clientWidth + 1 && !ellipsis
          if (overflow || box.right > viewport + 1) found.push(`${String(viewport)}: ${element.className || element.tagName} "${element.innerText.trim().slice(0, 40)}"`)
        }
        return found
      }, width)))
      await page.keyboard.press('Escape')
    }
  } finally {
    await clearPersonal(page)
    if (Object.keys(before.values).length > 0) {
      expect((await savePersonal(page, before.values)).ok).toBe(true)
    }
    await context.close()
  }
  report('german', clipped)
  expect(clipped).toEqual([])
})
