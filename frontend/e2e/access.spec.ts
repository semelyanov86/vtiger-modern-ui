/**
 * Stage 05 on the clean stand with users of different permissions (dev/clean/tools/seed.php): A — admin, A2 — second
 * administrator, U — mu.limited (role "MU Restricted Sales", no Leads and Campaigns), G — mu.viewer (role "MU Viewer",
 * view all). Checks:
 *
 * - administrator actions of ModernUI refused to U (data of the editor, save, export, logo), whatever is posted;
 * - personal settings: only allowed keys, another user's id in the request is ignored (IDOR), favorites only from the
 *   user's own modules;
 * - the menu of the theme follows the permissions of Vtiger: U's menu has no module U cannot open, every entry opens;
 *   a hidden module stays reachable; profiles and roles of the CRM are not changed by the menu settings;
 * - precedence default → global → role → user, a role profile for U's role, a personal value within the policy;
 * - a role change applies at once (new tokens key, other profile), no stale cache between roles;
 * - two administrators save at once: the second sees the conflict with the name of the first.
 */
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { adminCredentials, cleanUserCredentials, crmUrl, isClean, repoRoot, target, type CleanUser } from './env'
import { HOME, SETTINGS, SETTINGS_FORMS, isolateNetwork, signIn, waitForShell } from './support'
import {
  bootstrap, clearPersonal, editorData, get, globalScope, menuModules, post, saveGlobal, savePersonal, type Scope,
} from './settings-api'

test.describe.configure({ mode: 'serial' })
test.skip(!isClean, 'clean stand only (MU_E2E_TARGET=c81|c85)')

/** The refusal page of Vtiger (OperationNotPermitted.tpl); its text is also in the hidden js_strings of every page. */
const DENIED = /denied\.gif/

interface Session {
  context: BrowserContext
  page: Page
}

async function session(browser: Browser, user: CleanUser | 'admin'): Promise<Session> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const page = await context.newPage()
  await signIn(page, user === 'admin' ? adminCredentials() : cleanUserCredentials(user))
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
  return { context, page }
}

/** dev/clean/tools/set-role.php in the web container of the instance (the core API of Settings → Users → Edit). */
function setRole(user: string, role: string): void {
  execFileSync(resolve(repoRoot, 'dev/clean/clean.sh'), ['php', target, '/opt/mu-dev/clean/tools/set-role.php', '.', user, role], { stdio: 'pipe' })
}

async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name)
}

async function tokensKey(page: Page): Promise<string> {
  const href = (await page.locator('link[href*="action=Tokens"]').getAttribute('href')) ?? ''
  return /[?&]r=([0-9a-f]+)/.exec(href)?.[1] ?? ''
}

let admin: Session
let admin2: Session
let limited: Session
let viewer: Session
let original: Scope
let limitedRole = ''

test.beforeAll(async ({ browser }) => {
  admin = await session(browser, 'admin')
  admin2 = await session(browser, 'admin2')
  limited = await session(browser, 'limited')
  viewer = await session(browser, 'viewer')
  await admin.page.goto(SETTINGS_FORMS)
  original = await globalScope(admin.page)
  // The theme for everybody, the defaults otherwise.
  const saved = await saveGlobal(admin.page, { 'theme.mode': 'all' }, original.revision)
  expect(saved.ok, saved.text.slice(0, 300)).toBe(true)
  const roles = (await editorData(admin.page))['roles'] as { id: string; name: string }[]
  limitedRole = roles.find((role) => role.name === 'MU Restricted Sales')?.id ?? ''
  expect(limitedRole).not.toBe('')
  for (const user of [limited, viewer]) {
    await user.page.goto(HOME)
    await clearPersonal(user.page)
  }
})

test.afterAll(async () => {
  setRole('mu.limited', 'MU Restricted Sales')
  await admin.page.goto(SETTINGS_FORMS)
  const roles = (await editorData(admin.page))['roles'] as { id: string; profile: { revision: number } | null }[]
  for (const role of roles) {
    if (role.profile !== null) {
      await post(admin.page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'deleteRole', role: role.id, baseRevision: String(role.profile.revision) })
    }
  }
  const current = await globalScope(admin.page)
  expect((await saveGlobal(admin.page, original.values, current.revision)).ok).toBe(true)
  for (const user of [limited, viewer]) {
    await user.page.goto(HOME)
    await clearPersonal(user.page)
  }
  for (const s of [admin, admin2, limited, viewer]) {
    await s.context.close()
  }
})

test('a restricted user cannot use the administrator actions of ModernUI, whatever is posted', async () => {
  const page = limited.page
  await page.goto(HOME)
  const before = await globalScope(admin.page)
  await page.goto(SETTINGS)
  await expect(page.locator('.mu-editor')).toHaveCount(0)
  await expect(page.locator('img[src*="denied.gif"]')).toHaveCount(1)
  await page.goto(HOME)
  const attempts = [
    await get(page, { module: 'ModernUI', parent: 'Settings', action: 'Data' }),
    await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'global', role: '', values: JSON.stringify({ 'theme.mode': 'off' }), baseRevision: String(before.revision), inherit: '0' }),
    await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'resetUser', user: '1' }),
    await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'apply', json: '{}', parts: 'global', fingerprint: '0' }),
    await get(page, { module: 'ModernUI', parent: 'Settings', action: 'Transfer', mode: 'export', parts: 'global,users' }),
  ]
  for (const attempt of attempts) {
    expect(attempt.ok).toBe(false)
    expect(attempt.text).not.toContain('modernui.settings')
  }
  expect((await globalScope(admin.page)).revision).toBe(before.revision)
})

test('personal settings: only allowed keys, the id of another user is ignored, favorites only from own modules', async () => {
  const page = limited.page
  await page.goto(HOME)
  const forbidden = await savePersonal(page, { 'appearance.primaryColor': '#123456' })
  expect(forbidden.error?.code).toBe('MU_FORBIDDEN_KEY')
  const notMine = await savePersonal(page, { 'navigation.favorites': ['Leads'] })
  expect(notMine.error?.code).toBe('MU_INVALID_VALUE')
  expect(notMine.error?.params?.['path']).toBe('navigation.favorites[0]')
  // Another user in the request (parameters the action never reads): the user of the session is changed.
  const adminBefore = (await bootstrap(admin.page))['personal'] as { revision: number }
  const own = await savePersonal(page, { locale: 'de-DE', 'navigation.favorites': ['Contacts'] }, { user: '1', record: '1', userid: '1', scope_key: '1' })
  expect(own.ok, own.text.slice(0, 200)).toBe(true)
  expect(((await bootstrap(admin.page))['personal'] as { revision: number }).revision).toBe(adminBefore.revision)
  const data = await bootstrap(page)
  expect(data['locale']).toMatchObject({ effective: 'de-DE', source: 'personal' })
  expect((data['menu'] as { favorites: { id: string }[] }).favorites.map((item) => item.id)).toEqual(['m:Contacts'])
  await clearPersonal(page)
})

test('the menu follows the permissions of Vtiger: no module without permission, every entry opens, hidden stays reachable', async () => {
  // A configuration that names modules U may not open.
  await admin.page.goto(SETTINGS_FORMS)
  const current = await globalScope(admin.page)
  const groups = [{ id: 'work', label: { '*': 'Work' }, icon: 'briefcase', collapsed: false, items: ['Leads', 'Campaigns', 'Contacts', 'Accounts'].map((module) => ({ type: 'module', module, label: null, icon: null })) }]
  expect((await saveGlobal(admin.page, { ...current.values, 'navigation.groups': groups }, current.revision)).ok).toBe(true)

  await limited.page.goto(HOME)
  const limitedModules = menuModules(await bootstrap(limited.page))
  expect(limitedModules).not.toContain('Leads')
  expect(limitedModules).not.toContain('Campaigns')
  expect(limitedModules).toContain('Contacts')
  await viewer.page.goto(HOME)
  expect(menuModules(await bootstrap(viewer.page))).toContain('Leads')

  // Every entry of U's menu opens without a refusal of Vtiger; the forbidden module is refused by Vtiger itself.
  const menu = (await bootstrap(limited.page))['menu'] as { groups: { items: { url: string }[] }[] }
  for (const url of new Set(menu.groups.flatMap((group) => group.items.map((item) => item.url)))) {
    const response = await limited.page.request.get(url)
    expect(response.status(), url).toBe(200)
    expect(await response.text(), url).not.toMatch(DENIED)
  }
  expect(await (await limited.page.request.get('index.php?module=Leads&view=List')).text()).toMatch(DENIED)
  // The v7 menu of U has nothing the theme menu lacks.
  await limited.page.goto(HOME)
  const v7 = await limited.page.evaluate(() => Array.from(document.querySelectorAll('#app-menu .app-modules-dropdown a[href]'))
    .map((link) => new URL(link.getAttribute('href') ?? '', document.baseURI).searchParams.get('module') ?? '').filter((name) => name !== ''))
  for (const module of new Set(v7)) {
    expect(limitedModules, module).toContain(module)
  }

  // Hiding Contacts takes it out of the menu of G, not out of the CRM.
  const again = await globalScope(admin.page)
  expect((await saveGlobal(admin.page, { ...again.values, 'navigation.groups': null, 'navigation.hidden': ['Contacts'] }, again.revision)).ok).toBe(true)
  expect(menuModules(await bootstrap(viewer.page))).not.toContain('Contacts')
  const contacts = await viewer.page.goto('index.php?module=Contacts&view=List')
  expect(contacts?.status()).toBe(200)
  await expect(viewer.page.locator('img[src*="denied.gif"]')).toHaveCount(0)
  const reset = await globalScope(admin.page)
  expect((await saveGlobal(admin.page, { 'theme.mode': 'all' }, reset.revision)).ok).toBe(true)
})

test('precedence: defaults → common → role profile → personal value allowed by the policy', async () => {
  await admin.page.goto(SETTINGS_FORMS)
  const current = await globalScope(admin.page)
  expect((await saveGlobal(admin.page, { ...current.values, 'appearance.density': 'compact' }, current.revision)).ok).toBe(true)
  const profile = await post(admin.page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'save', scope: 'role', role: limitedRole,
    values: JSON.stringify({ 'appearance.primaryColor': '#0a7d4f', 'appearance.density': 'comfortable' }), baseRevision: '0', inherit: '0' })
  expect(profile.ok, profile.text.slice(0, 300)).toBe(true)
  expect((await savePersonal(limited.page, { 'appearance.fontScale': 110 })).ok).toBe(true)

  await limited.page.goto(HOME)
  await waitForShell(limited.page)
  expect(await cssVar(limited.page, '--mu-primary')).toBe('#0a7d4f')
  expect(await cssVar(limited.page, '--mu-row-height')).toBe('48px')
  expect(await cssVar(limited.page, '--mu-font-scale')).toBe('1.1')
  await viewer.page.goto(HOME)
  await waitForShell(viewer.page)
  expect(await cssVar(viewer.page, '--mu-primary')).toBe('#3978fe')
  expect(await cssVar(viewer.page, '--mu-row-height')).toBe('32px')

  // Without the font scale in the policy the personal value no longer applies (it stays stored).
  const policy = await globalScope(admin.page)
  expect((await saveGlobal(admin.page, { ...policy.values, 'policy.userOverrides': ['locale'] }, policy.revision)).ok).toBe(true)
  await limited.page.goto(HOME)
  await waitForShell(limited.page)
  expect(await cssVar(limited.page, '--mu-font-scale')).toBe('1')
  const back = await globalScope(admin.page)
  const restored = { ...back.values }
  delete restored['policy.userOverrides']
  expect((await saveGlobal(admin.page, restored, back.revision)).ok).toBe(true)
})

test('a role change applies at once: another profile, a new tokens key, no stale cache between roles', async () => {
  await limited.page.goto(HOME)
  await waitForShell(limited.page)
  const keyBefore = await tokensKey(limited.page)
  expect(await cssVar(limited.page, '--mu-primary')).toBe('#0a7d4f')
  setRole('mu.limited', 'MU Viewer')
  await limited.page.goto(HOME)
  await waitForShell(limited.page)
  expect(await tokensKey(limited.page)).not.toBe(keyBefore)
  expect(await cssVar(limited.page, '--mu-primary')).toBe('#3978fe')
  expect(await cssVar(limited.page, '--mu-row-height')).toBe('32px')
  // The view-all profile of the new role opens Leads: the menu follows at once.
  expect(menuModules(await bootstrap(limited.page))).toContain('Leads')
  setRole('mu.limited', 'MU Restricted Sales')
  await limited.page.goto(HOME)
  await waitForShell(limited.page)
  expect(await tokensKey(limited.page)).toBe(keyBefore)
  expect(await cssVar(limited.page, '--mu-primary')).toBe('#0a7d4f')
  expect(menuModules(await bootstrap(limited.page))).not.toContain('Leads')
})

test('two administrators save at once: the second sees the conflict with the name of the first', async () => {
  await admin.page.goto(`${SETTINGS}#mu-appearance`)
  await admin2.page.goto(`${SETTINGS}#mu-appearance`)
  await expect(admin.page.locator('.mu-editor .mu-tabs')).toBeVisible()
  await expect(admin2.page.locator('.mu-editor .mu-tabs')).toBeVisible()
  await admin.page.locator('[data-mu-field="mu-background"]').fill('#f5f6f8')
  await admin.page.locator('[data-mu-action="save"]').click()
  await expect(admin.page.locator('[data-mu-status].mu-text-success')).toBeVisible()
  await admin2.page.locator('[data-mu-field="mu-surface"]').fill('#fdfdfd')
  await admin2.page.locator('[data-mu-action="save"]').click()
  const dialog = admin2.page.locator('[data-mu-dialog="conflict"]')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('(admin)')
  await dialog.locator('[data-mu-action="conflict-load"]').click()
  await expect(admin2.page.locator('[data-mu-field="mu-background"]')).toHaveValue('#f5f6f8')
})

test('navigation of a restricted user: mega menu and favorites only with modules U may open, no rail, no administrator entries', async () => {
  const page = limited.page
  await page.goto('index.php?module=Contacts&view=List&app=MARKETING')
  await waitForShell(page)
  const data = await bootstrap(page)
  const menu = data['menu'] as { modules: string[]; groups: { items: { module: string; id: string }[] }[]; system: { id: string }[] }
  expect(menu.modules).not.toContain('Leads')
  expect(menu.modules).not.toContain('Campaigns')
  // Every entry of U's v7 app menu is covered by the theme; the v7 hamburger is replaced.
  const v7 = await page.evaluate(() => Array.from(document.querySelectorAll('#app-menu a[href], #app-menu [data-default-url]'))
    .map((element) => new URL(element.getAttribute('href') ?? element.getAttribute('data-default-url') ?? '#', document.baseURI).searchParams.get('module') ?? '')
    .filter((name) => name !== ''))
  for (const module of new Set(v7)) {
    expect(menu.modules, module).toContain(module)
  }
  await expect(page.locator('#appnavigator')).toBeHidden()

  // The mega menu shows exactly the modules of U's menu, section by section, and no settings entries.
  await page.locator('[data-mu-trigger="mega-menu"]').click()
  const panel = page.locator('[data-mu-panel="mega-menu"]')
  const shown = new Set<string>()
  for (const tab of await panel.locator('[role="tab"]').all()) {
    await tab.click()
    for (const id of await panel.locator('#mu-mega-panel [data-mu-item^="m:"]').evaluateAll((links) => links.map((link) => link.getAttribute('data-mu-item') ?? ''))) {
      shown.add(id.slice(2))
    }
  }
  expect([...shown].sort()).toEqual([...new Set(menuModules(data))].sort())
  expect(shown.has('Leads')).toBe(false)
  for (const id of ['moduleSettings', 'crmSettings', 'users']) {
    await expect(panel.locator(`[data-mu-item="${id}"]`)).toHaveCount(0)
  }
  await page.keyboard.press('Escape')

  // No permanent module rail (stage 11): the modules of U's v7 strip are in the mega menu above.
  await expect(page.locator('#modnavigator')).toBeHidden()
  // Favorites: the module of the page with the star, kept on the server, removed again.
  await page.locator('[data-mu-trigger="favorites"]').click()
  await page.locator('[data-mu-item="favorite-toggle"]').click()
  await expect(page.locator('.mu-favbar__tab[data-mu-item="m:Contacts"]')).toBeVisible()
  expect(((await bootstrap(page))['menu'] as { favorites: { module: string }[] }).favorites.map((item) => item.module)).toEqual(['Contacts'])
  await clearPersonal(page)

  // G (view all) sees Leads in the mega menu search.
  await viewer.page.goto(HOME)
  await waitForShell(viewer.page)
  await viewer.page.locator('[data-mu-trigger="mega-menu"]').click()
  await viewer.page.locator('[data-mu-field="menu-search"]').fill('Lead')
  await expect(viewer.page.locator('#mu-mega-panel [data-mu-item="m:Leads"]').first()).toBeVisible()
  await viewer.page.keyboard.press('Escape')
})
