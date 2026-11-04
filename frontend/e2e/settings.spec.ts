/**
 * Stage 05 — Settings → ModernUI and personal preferences, as an administrator, on the dev instance and the clean
 * stand (project "settings"): the editor and its sections, language of the theme switched with an unsaved draft,
 * preview / cancel / save / reset of the appearance, next page and new tab, invalid values and direct requests
 * (paths of the errors, CSRF, method, revision conflict), two sessions saving at once, the menu (keyboard, hiding with
 * undo, labels RU/EN/DE, preview, direct URL of a hidden module, new and unknown modules), logo upload (PNG accepted,
 * SVG and PHP refused), export and import (preview, invalid values, apply), personal preferences (language without
 * losing the draft, favorites, compact, conflict of two tabs, reset), a narrow screen in German.
 *
 * Every change is undone at the end: the global document and the personal settings of the administrator are written
 * back as they were found. The dev instance gets no record of the CRM, only the own tables of ModernUI change.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { crmUrl, repoRoot, stateFile, target } from './env'
import { HOME, SETTINGS, SETTINGS_FORMS, PREFERENCES, isolateNetwork, waitForShell } from './support'
import {
  bootstrap, clearPersonal, editorData, errorPaths, get, globalScope, menuModules, patchGlobal, pngFile, post, saveGlobal, savePersonal,
  type Scope,
} from './settings-api'

test.describe.configure({ mode: 'serial' })

let original: Scope
let originalPersonal: Record<string, unknown> = {}

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: stateFile('admin') })
  await isolateNetwork(context)
  return context.newPage()
}

async function openEditor(page: Page, section = 'appearance'): Promise<void> {
  // A new document every time (a change of the fragment alone would not reload the editor).
  await page.goto(`${SETTINGS}&mu=${String(Date.now())}#mu-${section}`)
  await expect(page.locator('.mu-editor .mu-tabs')).toBeVisible()
  await expect(page.locator(`[data-mu-tab="${section}"][data-state="active"]`)).toBeVisible()
}

async function clickSave(page: Page): Promise<void> {
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && (response.request().postData() ?? '').includes('mode=save'))
  await page.locator('[data-mu-action="save"]').click()
  expect((await saved).status()).toBe(200)
  await expect(page.locator('[data-mu-status].mu-text-success')).toBeVisible()
}

async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name)
}

async function inlineVar(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => document.documentElement.style.getPropertyValue(variable).trim(), name)
}

test.beforeAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto(SETTINGS_FORMS)
  // The theme on for this administrator (the editor works without it too, the checks of the pages need it).
  if ((await page.locator('button[name="modernui-enable-for-me"]').count()) > 0) {
    await Promise.all([page.waitForURL(/result=/), page.locator('button[name="modernui-enable-for-me"]').click()])
  }
  original = await globalScope(page)
  const data = await bootstrap(page)
  originalPersonal = (data['personal'] as { values: Record<string, unknown> }).values
  await clearPersonal(page)
  await page.context().close()
})

test.afterAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto(SETTINGS_FORMS)
  const current = await globalScope(page)
  const restored = await saveGlobal(page, original.values, current.revision)
  expect(restored.ok, `restore: ${restored.text.slice(0, 300)}`).toBe(true)
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

test('editor: five sections; the language of the theme switches with an unsaved draft and keeps it', async ({ page }) => {
  await openEditor(page)
  for (const tab of ['appearance', 'menu', 'access', 'compatibility', 'transfer']) {
    await expect(page.locator(`[data-mu-tab="${tab}"]`)).toBeVisible()
  }
  await page.locator('[data-mu-field="mu-primary"]').fill('#0a7d4f')
  await expect.poll(() => inlineVar(page, '--mu-primary')).toBe('#0a7d4f')
  const texts: Record<string, string> = { 'de-DE': 'Darstellung', 'ru-RU': 'Оформление', 'en-US': 'Appearance' }
  for (const [locale, text] of Object.entries(texts)) {
    const saved = page.waitForResponse((response) => (response.request().postData() ?? '').includes('action=Preferences'))
    await page.locator('[data-mu-field="language"]').selectOption(locale)
    expect((await saved).status()).toBe(200)
    await expect(page.locator('[data-mu-tab="appearance"]')).toContainText(text)
    await expect(page.locator('html')).not.toHaveAttribute('lang', 'x')
    // The draft stays: the value, the preview and the unsaved state.
    await expect(page.locator('[data-mu-field="mu-primary"]')).toHaveValue('#0a7d4f')
    await expect(page.locator('[data-mu-tab="appearance"] .mu-tabs__dot')).toBeVisible()
  }
  expect((await bootstrap(page))['locale']).toMatchObject({ effective: 'en-US', source: 'personal' })
  await page.locator('[data-mu-action="cancel"]').click()
  await expect(page.locator('[data-mu-field="mu-primary"]')).not.toHaveValue('#0a7d4f')
  await expect.poll(() => inlineVar(page, '--mu-primary')).not.toBe('#0a7d4f')
  await expect(page.locator('[data-mu-tab="appearance"] .mu-tabs__dot')).toHaveCount(0)
})

test('appearance: preview without saving, save applies on the next page and in a new tab, section reset', async ({ page, context }) => {
  await openEditor(page)
  const rowBefore = await cssVar(page, '--mu-row-height')
  await page.locator('[data-mu-density="compact"]').check()
  await page.locator('[data-mu-font-scale="110"]').check()
  await expect.poll(() => inlineVar(page, '--mu-row-height')).toBe('32px')
  await expect.poll(() => inlineVar(page, '--mu-font-scale')).toBe('1.1')
  // Nothing is published before saving: Bootstrap still has the saved values.
  const savedDensity = (await globalScope(page)).values['appearance.density']
  expect((await bootstrap(page))['appearance']).toMatchObject({ density: typeof savedDensity === 'string' ? savedDensity : 'standard' })
  await clickSave(page)

  await page.goto(HOME)
  await waitForShell(page)
  expect(await cssVar(page, '--mu-row-height')).toBe('32px')
  expect(await cssVar(page, '--mu-font-scale')).toBe('1.1')
  const tab = await context.newPage()
  await tab.goto('index.php?module=Accounts&view=List')
  await waitForShell(tab)
  expect(await cssVar(tab, '--mu-row-height')).toBe('32px')
  // The tokens stylesheet alone (shell blocked) already carries the saved values: a new key, not a cached old sheet.
  const href = await tab.locator('link[href*="action=Tokens"]').getAttribute('href')
  const css = await (await tab.request.get(href ?? '')).text()
  expect(css).toContain('--mu-row-height:32px')
  await tab.close()

  await openEditor(page)
  await page.locator('[data-mu-action="reset-section"]').click()
  await expect(page.locator('[data-mu-density="standard"]')).toBeChecked()
  await clickSave(page)
  await page.goto(HOME)
  await waitForShell(page)
  expect(await cssVar(page, '--mu-row-height')).toBe(rowBefore === '' ? '40px' : rowBefore)
  expect((await globalScope(page)).values['theme.mode']).toBe(original.values['theme.mode'] ?? 'off')
})

test('invalid values and direct requests are refused with the path; CSRF, method and revision are checked', async ({ page }) => {
  await openEditor(page)
  await page.locator('[data-mu-field="mu-primary"]').fill('#ffffff')
  await expect(page.locator('.mu-color-field .mu-field__error').first()).toBeVisible()
  await expect.poll(() => inlineVar(page, '--mu-primary')).not.toBe('#ffffff')
  await expect(page.locator('[data-mu-action="save"]')).toBeDisabled()

  const before = await globalScope(page)
  const group = (change: Record<string, unknown>): unknown[] => [{ id: 'g', label: null, icon: null, collapsed: false, items: [], ...change }]
  const cases: [Record<string, unknown>, string][] = [
    [{ 'appearance.primaryColor': 'red' }, 'appearance.primaryColor'],
    [{ 'appearance.background': '#000000' }, 'appearance.background'],
    [{ 'navigation.groups': group({ label: { 'en-US': '<img src=x onerror=alert(1)>' } }) }, 'navigation.groups[0].label.en-US'],
    [{ 'navigation.groups': group({ url: 'https://example.org/' }) }, 'navigation.groups[0].url'],
    [{ 'navigation.groups': group({ items: [{ type: 'route', id: 'x', label: { '*': 'X' }, route: { module: 'Leads', view: 'List', params: { href: 'javascript:alert(1)' } } }] }) }, 'navigation.groups[0].items[0].route.params.href'],
    [{ 'branding.title': { 'de-DE': 'ß'.repeat(61) } }, 'branding.title.de-DE'],
    [{ 'branding.logo': '../../config.inc.php' }, 'branding.logo'],
    [{ 'theme.customCss': 'body{display:none}' }, 'theme.customCss'],
  ]
  for (const [change, path] of cases) {
    const refused = await saveGlobal(page, { ...before.values, ...change }, before.revision)
    expect(refused.ok, path).toBe(false)
    expect(refused.status, path).toBe(400)
    expect(errorPaths(refused), path).toContain(path)
  }
  // No CSRF token, wrong method: refused by the core.
  const noToken = await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'global', role: '',
    values: JSON.stringify(before.values), baseRevision: String(before.revision), inherit: '0' }, false)
  expect(noToken.ok).toBe(false)
  const viaGet = await get(page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'global', values: '{}', baseRevision: String(before.revision) })
  expect(viaGet.ok).toBe(false)
  // A stale revision is a conflict with the current revision, its author and time.
  const stale = await saveGlobal(page, before.values, before.revision - 1)
  expect(stale.status).toBe(409)
  expect(stale.error?.code).toBe('MU_CONFLICT')
  expect(stale.error?.params?.['revision']).toBe(before.revision)
  expect(typeof stale.error?.params?.['updatedAt']).toBe('string')
  expect((await globalScope(page)).revision).toBe(before.revision)
})

test('two sessions save at once: the second gets a conflict, loads the current values or overwrites them', async ({ browser, page }) => {
  const other = await adminPage(browser)
  other.on('dialog', (dialog) => {
    void dialog.accept()
  })
  await openEditor(page)
  await openEditor(other)
  await page.locator('[data-mu-field="mu-background"]').fill('#f5f6f8')
  await clickSave(page)

  await other.locator('[data-mu-field="mu-surface"]').fill('#fdfdfd')
  await other.locator('[data-mu-action="save"]').click()
  const dialog = other.locator('[data-mu-dialog="conflict"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('ul').first()).not.toBeEmpty()
  await dialog.locator('[data-mu-action="conflict-load"]').click()
  await expect(dialog).toBeHidden()
  await expect(other.locator('[data-mu-field="mu-background"]')).toHaveValue('#f5f6f8')
  expect((await globalScope(page)).values['appearance.surface']).not.toBe('#fdfdfd')

  await other.locator('[data-mu-field="mu-surface"]').fill('#fdfdfd')
  await page.locator('[data-mu-field="mu-primary"]').fill('#1d4ed8')
  await clickSave(page)
  await other.locator('[data-mu-action="save"]').click()
  await other.locator('[data-mu-dialog="conflict"] [data-mu-action="conflict-overwrite"]').click()
  await expect(other.locator('[data-mu-status].mu-text-success')).toBeVisible()
  const values = (await globalScope(page)).values
  expect(values['appearance.surface']).toBe('#fdfdfd')
  expect(values['appearance.background']).toBe('#f5f6f8')
  await other.context().close()
  await patchGlobal(page, { 'appearance.surface': null, 'appearance.background': null, 'appearance.primaryColor': null })
})

test('menu: keyboard order, hiding with undo, labels in RU/EN/DE, preview, save; a hidden module still opens', async ({ page }) => {
  await openEditor(page, 'menu')
  const group = page.locator('.mu-group').first()
  const rows = group.locator('.mu-item')
  await expect(rows.first()).toBeVisible()
  const moved = (await rows.nth(0).getAttribute('data-mu-item')) ?? ''
  const relabelled = (await rows.nth(1).getAttribute('data-mu-item')) ?? ''
  expect(moved).toMatch(/^m:/)
  await rows.nth(0).focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(group.locator('.mu-item').nth(1)).toHaveAttribute('data-mu-item', moved)
  await expect(group.locator(`.mu-item[data-mu-item="${moved}"]`)).toBeFocused()
  await page.keyboard.press('Delete')
  await expect(page.locator('[data-mu-undo]')).toBeVisible()
  await expect(group.locator(`.mu-item[data-mu-item="${moved}"]`)).toHaveClass(/mu-item--hidden/)
  await page.locator('[data-mu-action="undo-hide"]').click()
  await expect(group.locator(`.mu-item[data-mu-item="${moved}"]`)).not.toHaveClass(/mu-item--hidden/)
  await group.locator(`.mu-item[data-mu-item="${moved}"] [data-mu-action="item-hide"]`).click()

  const german = 'Größenänderungsübersicht der Fußgängerübergänge'
  const russian = 'Съешь же ещё этих мягких французских булок'
  await group.locator(`.mu-item[data-mu-item="${relabelled}"] [data-mu-action="item-edit"]`).click()
  const dialog = page.locator('[data-mu-dialog="item"]')
  await dialog.locator('[data-mu-label="de-DE"]').fill(german)
  await dialog.locator('[data-mu-label="ru-RU"]').fill(russian)
  await dialog.locator('[data-mu-icon="star"]').click()
  await dialog.locator('[data-mu-action="dialog-save"]').click()
  await expect(dialog).toBeHidden()

  const preview = page.locator('[data-mu-preview="menu"]')
  await page.locator('[data-mu-field="preview-locale"]').selectOption('de-DE')
  await expect(preview).toContainText(german)
  await page.locator('[data-mu-field="preview-locale"]').selectOption('ru-RU')
  await expect(preview).toContainText(russian)
  await expect(preview.locator(`[data-mu-item="${moved}"]`)).toHaveCount(0)
  await clickSave(page)

  // The menu of the theme follows on the next page, in the language of the theme.
  expect((await savePersonal(page, { locale: 'de-DE' })).ok).toBe(true)
  const data = await bootstrap(page)
  const module = moved.slice(2)
  expect(menuModules(data)).not.toContain(module)
  const groups = (data['menu'] as { groups: { items: { id: string; label: string; icon: { kind: string; name?: string } }[] }[] }).groups
  const item = groups.flatMap((entry) => entry.items).find((entry) => entry.id === relabelled)
  expect(item?.label).toBe(german)
  expect(item?.icon).toEqual({ kind: 'lucide', name: 'star' })
  await page.goto(HOME)
  await waitForShell(page)
  await page.locator('.mu-navigation__trigger').click()
  const panel = page.locator('#mu-overlay-root .mu-navigation')
  await expect(panel).toContainText(german)
  await expect(panel.locator(`[data-mu-item="${moved}"]`)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.locator('.mu-navigation__trigger')).toBeFocused()
  // Hiding is only the menu: the module itself opens as before.
  const response = await page.goto(`index.php?module=${module}&view=List`)
  expect(response?.status()).toBe(200)
  // Not the refusal page of Vtiger (OperationNotPermitted.tpl; its text is also in the hidden js_strings of any page).
  await expect(page.locator('img[src*="denied.gif"]')).toHaveCount(0)
  await expect(page.locator('#listViewContent, .listViewPageDiv, #listview-table').first()).toBeAttached()

  await openEditor(page, 'menu')
  await page.locator('[data-mu-action="reset-section"]').click()
  await clickSave(page)
  expect(menuModules(await bootstrap(page))).toContain(module)
  await clearPersonal(page)
})

test('menu: modules outside the configuration appear by themselves, unknown modules are flagged and skipped', async ({ page }) => {
  await openEditor(page, 'menu')
  await patchGlobal(page, {
    'navigation.groups': [{ id: 'mine', label: { '*': 'Mine' }, icon: 'star', collapsed: false, items: [
      { type: 'module', module: 'Contacts', label: null, icon: null },
      { type: 'module', module: 'NoSuchModule', label: null, icon: null },
    ] }],
  })
  const data = await bootstrap(page)
  const groups = (data['menu'] as { groups: { id: string; items: { module: string }[] }[] }).groups
  expect(groups[0]?.id).toBe('mine')
  expect(groups[0]?.items.map((entry) => entry.module)).toEqual(['Contacts'])
  const other = groups.find((entry) => entry.id === 'other')
  expect(other?.items.length ?? 0).toBeGreaterThan(3)
  if (target !== 'dev') {
    // The test entity module of the clean stand, unknown to the configuration.
    expect(other?.items.map((entry) => entry.module)).toContain('Gadgets')
  }
  await openEditor(page, 'menu')
  await expect(page.locator('.mu-item--unknown[data-mu-item="m:NoSuchModule"]')).toBeVisible()
  const preview = await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'previewMenu', locale: 'en-US',
    values: JSON.stringify({ 'navigation.groups': (await globalScope(page)).values['navigation.groups'] }) })
  expect(preview.result['unknownModules']).toEqual(['NoSuchModule'])
  await patchGlobal(page, { 'navigation.groups': null })
})

test('logo: PNG accepted and shown in the header only; SVG, PHP and oversized files refused; then back to the CRM logo', async ({ page }) => {
  await page.goto(HOME)
  const companyLogo = await page.locator('nav.app-fixed-navbar .company-logo > img').getAttribute('src')
  await openEditor(page)
  await page.locator('[data-mu-logo="custom"]').check()
  const input = page.locator('[data-mu-field="logo-file"]')
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  await input.setInputFiles({ name: 'logo.svg', mimeType: 'image/svg+xml', buffer: svg })
  await expect(page.locator('[data-mu-error="logo"]')).toBeVisible()
  await input.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from('<?php echo "x"; ?>') })
  await expect(page.locator('[data-mu-error="logo"]')).toBeVisible()
  // The server refuses a large file by itself too (the editor stops it before sending).
  const large = await page.request.post('index.php', {
    multipart: { module: 'ModernUI', parent: 'Settings', action: 'Logo', mode: 'upload', __vtrftk: await page.evaluate(() => String((window as unknown as { csrfMagicToken?: unknown }).csrfMagicToken)),
      logo: { name: 'big.png', mimeType: 'image/png', buffer: Buffer.concat([await pngFile(8, 8, [1, 2, 3]), Buffer.alloc(600 * 1024)]) } },
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${crmUrl()}index.php` },
  })
  expect(await large.text()).toContain('MU_LOGO_TOO_LARGE')

  await input.setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: await pngFile(240, 60, [10, 125, 79]) })
  await expect(page.locator('.mu-logo__preview')).toBeVisible()
  await page.locator('[data-mu-title="custom"]').check()
  await page.locator('[data-mu-label="en-US"]').fill('Fußgänger CRM')
  await page.locator('[data-mu-label="ru-RU"]').fill('Окна CRM')
  await page.locator('[data-mu-label="de-DE"]').fill('Fußgänger CRM')
  await clickSave(page)

  await page.goto(HOME)
  await waitForShell(page)
  const logo = page.locator('nav.app-fixed-navbar .company-logo .mu-brand__logo')
  await expect(logo).toBeVisible()
  const src = (await logo.getAttribute('src')) ?? ''
  expect(src).toMatch(/^public\.php\?type=logo&key=modernui_[0-9a-f]{40}\.png$/)
  const image = await page.request.get(src)
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toMatch(/image\/png/)
  await expect(page.locator('html')).toHaveAttribute('data-mu-replaced', /logo/)
  await expect(page.locator('nav.app-fixed-navbar .company-logo > img')).toBeHidden()
  await expect(page.locator('.mu-brand__title')).toBeVisible()
  // The logo of the CRM itself (documents, other users without the theme) is not changed.
  expect(await page.locator('nav.app-fixed-navbar .company-logo > img').getAttribute('src')).toBe(companyLogo)

  await openEditor(page)
  await page.locator('[data-mu-logo="company"]').check()
  await page.locator('.mu-choice[data-mu-key="branding.title"] input[type="radio"]').first().check()
  await clickSave(page)
  await page.goto(HOME)
  await waitForShell(page)
  await expect(page.locator('.mu-brand__logo')).toHaveCount(0)
  await expect(page.locator('nav.app-fixed-navbar .company-logo > img')).toBeVisible()
})

test('export and import: versioned JSON without ids or logo; preview with changes and invalid values; apply', async ({ page }) => {
  await openEditor(page, 'transfer')
  const exported = await page.request.get('index.php?module=ModernUI&parent=Settings&action=Transfer&mode=export&parts=global,roles,users', {
    headers: { Referer: `${crmUrl()}index.php` },
  })
  expect(exported.headers()['content-disposition']).toMatch(/attachment; filename="modernui-settings-/)
  const text = await exported.text()
  const file = JSON.parse(text) as Record<string, unknown>
  expect(file).toMatchObject({ format: 'modernui.settings', formatVersion: 1 })
  expect(text).not.toMatch(/"(?:userid|roleid|tabid|user_name|password|email1?|first_name|last_name)"\s*:/i)
  const pilot = ((file['global'] as { theme?: { pilot?: { users?: unknown[] } } }).theme?.pilot?.users ?? [])
  for (const entry of pilot) {
    expect(Object.keys(entry as object)).toEqual(['userName'])
  }
  mkdirSync(resolve(repoRoot, '.local/stage05'), { recursive: true })
  writeFileSync(resolve(repoRoot, `.local/stage05/export-${target}.json`), text)

  const changed = JSON.parse(text) as { global: Record<string, unknown> }
  changed.global['appearance'] = { primaryColor: '#8a2be2', background: '#000000' }
  await page.locator('[data-mu-field="import-file"]').setInputFiles({ name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) })
  const report = page.locator('[data-mu-report]')
  await expect(report).toBeVisible()
  await expect(report.locator('[data-mu-report-part="global"]')).toContainText('#8a2be2')
  await expect(report.locator('[data-mu-report-invalid]')).toBeVisible()
  await page.locator('[data-mu-action="import-apply"]').click()
  await expect(page.locator('[data-mu-import-message].mu-text-success')).toBeVisible()
  const values = (await globalScope(page)).values
  expect(values['appearance.primaryColor']).toBe('#8a2be2')
  expect(values['appearance.background']).toBeUndefined()
  expect(values['theme.mode']).toBe(original.values['theme.mode'] ?? 'off')

  await page.locator('[data-mu-field="import-file"]').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"format": "modernui.settings", ') })
  await expect(page.locator('[data-mu-import-message].mu-text-error')).toBeVisible()
  await patchGlobal(page, { 'appearance.primaryColor': null })

  // A file of the other stand (task test:e2e:clean writes .local/stage05/export-c81.json): roles and users are matched by
  // name, the unknown ones are listed, nothing depends on numeric ids.
  const foreign = resolve(repoRoot, `.local/stage05/export-${target === 'dev' ? 'c81' : 'dev'}.json`)
  if (existsSync(foreign)) {
    const content = readFileSync(foreign, 'utf8')
    const analysis = await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'preview', json: content })
    expect(analysis.ok, analysis.text.slice(0, 300)).toBe(true)
    const result = analysis.result['report'] as { global: { unresolvedUsers: string[] } | null; roles: { matched: unknown[]; unresolved: string[] } | null }
    const listed = (JSON.parse(content) as { global?: { theme?: { pilot?: { users?: { userName: string }[] } } } }).global?.theme?.pilot?.users ?? []
    for (const user of listed) {
      const known = ((await editorData(page))['users'] as { userName: string }[]).some((entry) => entry.userName.toLowerCase() === user.userName.toLowerCase())
      expect(known || (result.global?.unresolvedUsers ?? []).includes(user.userName), user.userName).toBe(true)
    }
    const applied = await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'apply', json: content, parts: 'global', includeMode: '0', fingerprint: String(analysis.result['fingerprint']) })
    expect(applied.ok, applied.text.slice(0, 300)).toBe(true)
    expect((await globalScope(page)).values['theme.mode']).toBe(original.values['theme.mode'] ?? 'off')
  }
})

test('preferences: language without losing the draft, favorites with keys, compact, conflict of two tabs, reset', async ({ browser, page }) => {
  await page.goto(PREFERENCES)
  const editor = page.locator('[data-mu-prefs]')
  await expect(editor).toBeVisible()
  await expect(page.locator('form.modernui-preferences-form')).toBeHidden()
  await page.locator('[data-mu-field="density"]').selectOption('compact')
  await page.locator('[data-mu-field="locale"]').selectOption('de-DE')
  await expect(editor.locator('.mu-editor__title')).toHaveText('Meine Einstellungen der neuen Oberfläche')
  await expect(page.locator('[data-mu-field="density"]')).toHaveValue('compact')
  await page.locator('[data-mu-field="locale"]').selectOption('ru-RU')
  await expect(editor.locator('.mu-editor__title')).toHaveText('Мои предпочтения нового интерфейса')
  await expect(editor.locator('.mu-editor__state')).toContainText('несохранённые')

  for (const module of ['Contacts', 'Accounts']) {
    await page.locator('[data-mu-field="favorite"]').selectOption(module)
    await page.locator('[data-mu-action="add-favorite"]').click()
  }
  await page.locator('[data-mu-favorite="Accounts"]').focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.locator('[data-mu-list="favorites"] > li').first()).toHaveAttribute('data-mu-favorite', 'Accounts')
  await page.locator('[data-mu-field="compact"]').check()
  await page.locator('[data-mu-action="save"]').click()
  await expect(editor.locator('[data-mu-status].mu-text-success')).toBeVisible()

  const data = await bootstrap(page)
  expect(data['locale']).toMatchObject({ effective: 'ru-RU', source: 'personal' })
  const menu = data['menu'] as { favorites: { id: string }[]; compact: boolean }
  expect(menu.favorites.map((item) => item.id)).toEqual(['m:Accounts', 'm:Contacts'])
  expect(menu.compact).toBe(true)
  await page.goto(HOME)
  await waitForShell(page)
  await expect(page.locator('.mu-navigation__trigger')).toHaveAttribute('aria-label', 'Модули')
  await page.locator('.mu-navigation__trigger').click()
  const chips = page.locator('#mu-overlay-root .mu-menu-panel__favorites--compact .mu-menu-panel__chip')
  await expect(chips).toHaveCount(2)
  await expect(chips.first()).toHaveAttribute('aria-label', /.+/)
  await page.keyboard.press('Escape')
  expect(await cssVar(page, '--mu-row-height')).toBe('32px')

  // Two tabs: the second save is a conflict, not an overwrite.
  const other = await adminPage(browser)
  await page.goto(PREFERENCES)
  await other.goto(PREFERENCES)
  await page.locator('[data-mu-field="density"]').selectOption('standard')
  await page.locator('[data-mu-action="save"]').click()
  await expect(page.locator('[data-mu-prefs] [data-mu-status].mu-text-success')).toBeVisible()
  await other.locator('[data-mu-field="font-scale"]').selectOption('125')
  await other.locator('[data-mu-action="save"]').click()
  await expect(other.locator('[data-mu-action="reload"]')).toBeVisible()
  await other.locator('[data-mu-action="reload"]').click()
  await expect(other.locator('[data-mu-field="density"]')).toHaveValue('standard')
  await expect(other.locator('[data-mu-field="font-scale"]')).toHaveValue('')
  await other.context().close()

  await page.locator('[data-mu-action="reset"]').click()
  await expect(page.locator('[data-mu-prefs] [data-mu-status].mu-text-success')).toBeVisible()
  expect((await bootstrap(page))['personal']).toMatchObject({ values: {}, revision: 0 })
})

test('narrow screen in German: the sections of the editor fit without overflow; long labels are cut with an ellipsis', async ({ page }) => {
  await page.goto(SETTINGS_FORMS)
  expect((await savePersonal(page, { locale: 'de-DE' })).ok).toBe(true)
  await page.setViewportSize({ width: 412, height: 900 })
  for (const section of ['appearance', 'menu', 'access', 'compatibility', 'transfer']) {
    await openEditor(page, section)
    const overflow = await page.locator('.mu-editor').evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(overflow, section).toBeLessThanOrEqual(1)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await clearPersonal(page)
})

test('without the editor: the server page keeps the switches and the pilot forms', async ({ page }) => {
  await page.goto(SETTINGS_FORMS)
  await expect(page.locator('[data-mu-root="settings-editor"]')).toHaveCount(0)
  await expect(page.locator('table.modernui-status')).toBeVisible()
  await expect(page.locator('button[name="modernui-recovery"]')).toBeVisible()
  await expect(page.locator('[data-mu-fallback="pilot"]')).toBeVisible()
  await page.goto(SETTINGS)
  await expect(page.locator('.mu-editor .mu-tabs')).toBeVisible()
  await expect(page.locator('[data-mu-fallback="pilot"]')).toBeHidden()
})
