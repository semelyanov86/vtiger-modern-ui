/**
 * Stage 16 — the page of ModernUI in the settings and the personal preferences (docs/design.md §13.12,
 * docs/settings.md §14), on the dev instance and the clean stand (project "settings-page"):
 *
 * - one page: one title, the sections in the order of the work, whom the settings apply to before any change, the
 *   service part apart from the everyday fields, the preview in view, the footer always reachable;
 * - where a value comes from: default / changed in the common settings, inherited / own in a role profile;
 * - preview without saving, cancel, a reset that names what it resets for whom;
 * - switching the scope with a draft (stay, do not save, save and switch), a save overtaken by another session (the
 *   work is carried over to the current version), the draft kept by the tab over a reload;
 * - the menu editor: search, adding from the catalog, moving by drag and drop onto a group, by keys and by the menu of
 *   a tile, empty groups, unknown modules — and the result in the real mega menu of a CRM page;
 * - personal preferences: only the person is affected, where each value comes from, favorites by keys and drag;
 *   on the clean stand the restricted user U: no administrator page, own preferences only;
 * - RU/EN/DE, 1440/1024/768/412 and 200 %, keyboard, without JavaScript.
 *
 * Only the own tables of ModernUI change; everything is written back as it was found (common settings, role profiles
 * created here, personal settings of the administrator and of U).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { cleanUserCredentials, crmUrl, isClean, stateFile } from './env'
import { HOME, PREFERENCES, SETTINGS, SETTINGS_FORMS, isolateNetwork, signIn, waitForShell } from './support'
import { bootstrap, clearPersonal, editorData, globalScope, patchGlobal, post, saveGlobal, savePersonal, type Scope } from './settings-api'

test.describe.configure({ mode: 'serial' })

const SECTIONS = ['enable', 'appearance', 'menu', 'access', 'compatibility', 'transfer', 'maintenance']
const ALL_USERS = /^(Все пользователи|All users|Alle Benutzer)$/

let original: Scope
let originalPersonal: Record<string, unknown> = {}
let originalProfiles: string[] = []

async function adminContext(browser: Browser, viewport = { width: 1440, height: 1000 }): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport, storageState: stateFile('admin') })
  await isolateNetwork(context)
  return context
}

async function adminPage(browser: Browser): Promise<Page> {
  const page = await (await adminContext(browser)).newPage()
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
  return page
}

async function open(page: Page, section: string): Promise<void> {
  await page.goto(`${SETTINGS}&mu=${String(Date.now())}#mu-${section}`)
  await expect(page.locator(`[data-mu-tab="${section}"][data-state="active"]`)).toBeVisible()
}

async function inlineVar(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => document.documentElement.style.getPropertyValue(variable).trim(), name)
}

async function clickSave(page: Page): Promise<void> {
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && (response.request().postData() ?? '').includes('mode=save'))
  await page.locator('[data-mu-footer] [data-mu-action="save"]').click()
  expect((await saved).status()).toBe(200)
  await expect(page.locator('[data-mu-status].mu-text-success')).toBeVisible()
}

async function chooseScope(page: Page, scope: string): Promise<void> {
  await page.locator('[data-mu-field="scope"]').click()
  await page.locator(`[data-mu-panel="scope"] [data-mu-scope="${scope}"]`).click()
}

async function roleProfiles(page: Page): Promise<{ id: string; name: string; revision: number | null }[]> {
  const roles = (await editorData(page))['roles'] as { id: string; name: string; root: boolean; missing: boolean; profile: { revision: number } | null }[]
  return roles.filter((role) => !role.root && !role.missing).map((role) => ({ id: role.id, name: role.name, revision: role.profile?.revision ?? null }))
}

test.beforeAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto(SETTINGS_FORMS)
  if ((await page.locator('button[name="modernui-enable-for-me"]').count()) > 0) {
    await Promise.all([page.waitForURL(/result=/), page.locator('button[name="modernui-enable-for-me"]').click()])
  }
  original = await globalScope(page)
  originalPersonal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  originalProfiles = (await roleProfiles(page)).filter((role) => role.revision !== null).map((role) => role.id)
  await page.context().close()
})

test.afterAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto(SETTINGS_FORMS)
  for (const role of await roleProfiles(page)) {
    if (role.revision !== null && !originalProfiles.includes(role.id)) {
      const removed = await post(page, { module: 'ModernUI', parent: 'Settings', action: 'Save', mode: 'deleteRole', role: role.id, baseRevision: String(role.revision) })
      expect(removed.ok, `remove profile ${role.id}`).toBe(true)
    }
  }
  const current = await globalScope(page)
  const restored = await saveGlobal(page, original.values, current.revision)
  expect(restored.ok, `restore: ${restored.text.slice(0, 300)}`).toBe(true)
  await clearPersonal(page)
  if (Object.keys(originalPersonal).length > 0) {
    expect((await savePersonal(page, originalPersonal)).ok).toBe(true)
  }
  expect(((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values).toEqual(originalPersonal)
  await page.context().close()
})

test.beforeEach(async ({ context, page }) => {
  await isolateNetwork(context)
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
})

test('one page: one title, the sections in the order of the work, the scope before any change, the service apart', async ({ page }) => {
  await open(page, 'appearance')
  await expect(page.locator('.modernui-page h4, .modernui-page h2, .modernui-page h1').filter({ visible: true }).first()).toHaveClass(/modernui-page__title/)
  await expect(page.locator('.modernui-page__title')).toHaveCount(1)
  await expect(page.locator('.mu-editor__title, .modernui-page h2')).toHaveCount(0)
  const tabs = await page.locator('[data-mu-tab]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-mu-tab')))
  expect(tabs).toEqual(SECTIONS)
  // Whom the settings apply to is on screen before anything is changed.
  await expect(page.locator('[data-mu-field="scope"]')).toBeVisible()
  await expect(page.locator('[data-mu-field="scope"] .mu-scope-button__text')).toHaveText(ALL_USERS)
  await expect(page.locator('[data-mu-scope-text]')).toBeVisible()
  await expect(page.locator('[data-mu-dirty]')).toHaveCount(0)
  await expect(page.locator('[data-mu-status-chip]')).toBeVisible()
  // The service part (status, switches, recovery, the check of this browser) only under "Service".
  await expect(page.locator('[data-mu-server="service"]')).toBeHidden()
  await expect(page.locator('button[name="modernui-recovery"]')).toBeHidden()
  await page.locator('[data-mu-tab="maintenance"]').click()
  await expect(page.locator('[data-mu-section="maintenance"] [data-mu-server="service"]')).toBeVisible()
  await expect(page.locator('button[name="modernui-recovery"]')).toBeVisible()
  await expect(page.locator('table.modernui-status')).toBeVisible()
  await expect(page.locator('[data-mu-root="settings-diagnostics"] .mu-diagnostics')).toBeVisible()
  // The preview stays in view while the form scrolls; the footer is always at hand.
  await page.locator('[data-mu-tab="appearance"]').click()
  await page.locator('[data-mu-key="branding.title"]').scrollIntoViewIfNeeded()
  const viewport = page.viewportSize()?.height ?? 1000
  const preview = await page.locator('[data-mu-preview="appearance"]').boundingBox()
  expect(preview?.y ?? -1).toBeGreaterThanOrEqual(100)
  expect(preview?.y ?? viewport).toBeLessThan(viewport / 2)
  const save = await page.locator('[data-mu-footer] [data-mu-action="save"]').boundingBox()
  expect((save?.y ?? viewport) + (save?.height ?? 0)).toBeLessThanOrEqual(viewport)
})

test('where a value comes from: default and changed in the common settings, inherited and own in a role profile', async ({ page }) => {
  await open(page, 'appearance')
  const density = page.locator('[data-mu-key="appearance.density"]')
  const before = await density.getAttribute('data-mu-state')
  const target = (await page.locator('[data-mu-density="comfortable"]').isChecked()) ? 'compact' : 'comfortable'
  await page.locator(`[data-mu-density="${target}"]`).check()
  await expect(density).toHaveAttribute('data-mu-state', 'set')
  await expect(density.locator('[data-mu-origin="set"]')).toBeVisible()
  await density.locator('[data-mu-default="appearance.density"]').click()
  await expect(density).toHaveAttribute('data-mu-state', 'default')
  await expect(page.locator('[data-mu-density="standard"]')).toBeChecked()
  // Back to the default is a change only when the common settings had their own value.
  const cancel = page.locator('[data-mu-footer] [data-mu-action="cancel"]')
  if (before === 'set') {
    await cancel.click()
  } else {
    await expect(cancel).toBeDisabled()
  }
  await expect(density).toHaveAttribute('data-mu-state', before ?? 'default')

  const role = (await roleProfiles(page)).find((entry) => entry.revision === null)
  expect(role, 'a role without a profile').toBeTruthy()
  await chooseScope(page, role?.id ?? '')
  await expect(page.locator('[data-mu-field="scope"] .mu-scope-button__text')).toContainText(role?.name ?? '')
  await expect(page.locator('[data-mu-field="inherit"]')).toBeVisible()
  await expect(page.locator('[data-mu-key="appearance.primaryColor"] [data-mu-origin="inherited"]')).toBeVisible()
  await expect(density.locator('[data-mu-origin="inherited"]')).toBeVisible()
  await page.locator('[data-mu-density="compact"]').check()
  await expect(density.locator('[data-mu-origin="own"]')).toBeVisible()
  await expect(page.locator('[data-mu-dirty]')).toContainText(role?.name ?? '')
  await density.locator('[data-mu-own="appearance.density"]').click()
  await expect(density.locator('[data-mu-origin="inherited"]')).toBeVisible()
  await expect(page.locator('[data-mu-dirty]')).toHaveCount(0)
  // Global-only sections say so in a role profile and lead back.
  await page.locator('[data-mu-tab="enable"]').click()
  await expect(page.locator('[data-mu-section="enable"]')).toHaveCount(0)
  await page.locator('[data-mu-action="open-common"]').click()
  await expect(page.locator('[data-mu-section="enable"]')).toBeVisible()
})

test('preview without saving, cancel, a reset that names the section and the scope', async ({ page }) => {
  await open(page, 'appearance')
  const saved = (await bootstrap(page))['appearance'] as { primaryColor: string }
  await page.locator('[data-mu-field="mu-primary"]').fill('#0a7d4f')
  await expect.poll(() => inlineVar(page, '--mu-primary')).toBe('#0a7d4f')
  await expect(page.locator('[data-mu-tab="appearance"] .mu-tabs__dot')).toBeVisible()
  await expect(page.locator('[data-mu-dirty]')).toContainText(/Все пользователи|All users|Alle Benutzer/)
  expect(((await bootstrap(page))['appearance'] as { primaryColor: string }).primaryColor).toBe(saved.primaryColor)
  await page.locator('[data-mu-footer] [data-mu-action="cancel"]').click()
  await expect(page.locator('[data-mu-field="mu-primary"]')).not.toHaveValue('#0a7d4f')
  await expect.poll(() => inlineVar(page, '--mu-primary')).not.toBe('#0a7d4f')
  const reset = page.locator('[data-mu-action="reset-section"]')
  await expect(reset).toContainText(/Все пользователи|All users|Alle Benutzer/)
  await expect(reset).toContainText(/Оформление|Appearance|Darstellung/)
  await page.locator('[data-mu-tab="transfer"]').click()
  await expect(reset).toHaveCount(0)
})

test('switching the scope with a draft: stay keeps it, do not save drops it, save and open saves it', async ({ page }) => {
  await open(page, 'appearance')
  const role = (await roleProfiles(page)).find((entry) => entry.revision === null)
  const savedSurface = (await page.locator('[data-mu-field="mu-surface"]').inputValue())
  await page.locator('[data-mu-field="mu-surface"]').fill('#fdfdfd')
  await chooseScope(page, role?.id ?? '')
  const dialog = page.locator('[data-mu-dialog="leave-draft"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-mu-action="leave-stay"]').click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-mu-field="scope"] .mu-scope-button__text')).toHaveText(ALL_USERS)
  await expect(page.locator('[data-mu-field="mu-surface"]')).toHaveValue('#fdfdfd')

  await chooseScope(page, role?.id ?? '')
  await dialog.locator('[data-mu-action="leave-discard"]').click()
  await expect(page.locator('[data-mu-field="scope"] .mu-scope-button__text')).toContainText(role?.name ?? '')
  await expect(page.locator('[data-mu-dirty]')).toHaveCount(0)
  await chooseScope(page, 'global')
  await expect(page.locator('[data-mu-field="mu-surface"]')).toHaveValue(savedSurface)

  await page.locator('[data-mu-field="mu-background"]').fill('#f5f6f8')
  await chooseScope(page, role?.id ?? '')
  const saved = page.waitForResponse((response) => (response.request().postData() ?? '').includes('mode=save'))
  await dialog.locator('[data-mu-action="leave-save"]').click()
  expect((await saved).status()).toBe(200)
  await expect(page.locator('[data-mu-field="scope"] .mu-scope-button__text')).toContainText(role?.name ?? '')
  expect((await globalScope(page)).values['appearance.background']).toBe('#f5f6f8')

  // A profile of the role: one own value, saved, then deleted from "Users and roles" with the confirmation of the theme.
  await page.locator('[data-mu-density="compact"]').check()
  await clickSave(page)
  expect((await roleProfiles(page)).find((entry) => entry.id === role?.id)?.revision).not.toBeNull()
  await chooseScope(page, 'global')
  await page.locator('[data-mu-tab="access"]').click()
  await page.locator(`[data-mu-role-row="${role?.id ?? ''}"] [data-mu-action="remove-profile"]`).click()
  await page.locator('[data-mu-dialog="confirm"] [data-mu-action="confirm-ok"]').click()
  await expect(page.locator('[data-mu-access-message]')).toBeVisible()
  expect((await roleProfiles(page)).find((entry) => entry.id === role?.id)?.revision).toBeNull()
  await patchGlobal(page, { 'appearance.background': original.values['appearance.background'] ?? null })
})

test('a save overtaken by another session: the changes are carried over to the current version and saved', async ({ browser, page }) => {
  const other = await adminPage(browser)
  await open(page, 'appearance')
  await open(other, 'appearance')
  await page.locator('[data-mu-field="mu-background"]').fill('#f4f5f7')
  await clickSave(page)
  await other.locator('[data-mu-field="mu-primary"]').fill('#1d4ed8')
  await other.locator('[data-mu-footer] [data-mu-action="save"]').click()
  const dialog = other.locator('[data-mu-dialog="conflict"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-mu-action="conflict-rebase"]')).toBeVisible()
  await dialog.locator('[data-mu-action="conflict-rebase"]').click()
  await expect(dialog).toBeHidden()
  await expect(other.locator('[data-mu-notice]')).toBeVisible()
  // The value saved by the first session is there, the draft of the second kept its own change.
  await expect(other.locator('[data-mu-field="mu-background"]')).toHaveValue('#f4f5f7')
  await expect(other.locator('[data-mu-field="mu-primary"]')).toHaveValue('#1d4ed8')
  await expect(other.locator('[data-mu-dirty]')).toBeVisible()
  await clickSave(other)
  const values = (await globalScope(page)).values
  expect(values['appearance.background']).toBe('#f4f5f7')
  expect(values['appearance.primaryColor']).toBe('#1d4ed8')
  await other.context().close()
  await patchGlobal(page, {
    'appearance.background': original.values['appearance.background'] ?? null,
    'appearance.primaryColor': original.values['appearance.primaryColor'] ?? null,
  })
})

test('reload keeps the draft of the tab: offered back, restored or discarded by the person', async ({ page }) => {
  await open(page, 'appearance')
  const saved = await page.locator('[data-mu-field="mu-surface"]').inputValue()
  await page.locator('[data-mu-field="mu-surface"]').fill('#fcfcfd')
  await page.waitForTimeout(600)
  await page.reload()
  const offer = page.locator('[data-mu-restore]')
  await expect(offer).toBeVisible()
  await expect(page.locator('[data-mu-field="mu-surface"]')).toHaveValue(saved)
  await offer.locator('[data-mu-action="restore-draft"]').click()
  await expect(page.locator('[data-mu-field="mu-surface"]')).toHaveValue('#fcfcfd')
  await expect(page.locator('[data-mu-dirty]')).toBeVisible()
  await page.locator('[data-mu-footer] [data-mu-action="cancel"]').click()
  await page.waitForTimeout(600)
  await page.reload()
  await expect(page.locator('[data-mu-tab="appearance"][data-state="active"]')).toBeVisible()
  await expect(offer).toHaveCount(0)

  await page.locator('[data-mu-field="mu-surface"]').fill('#fbfbfc')
  await page.waitForTimeout(600)
  await page.reload()
  await page.locator('[data-mu-action="restore-drop"]').click()
  await expect(offer).toHaveCount(0)
  await expect(page.locator('[data-mu-field="mu-surface"]')).toHaveValue(saved)
  await page.reload()
  await expect(page.locator('[data-mu-tab="appearance"][data-state="active"]')).toBeVisible()
  await expect(offer).toHaveCount(0)
})

test('menu editor: search, catalog, drag onto a group, keys, the menu of a tile, empty and unknown; the real mega menu follows', async ({ page }) => {
  await page.goto(SETTINGS_FORMS)
  const catalog = ((await editorData(page))['catalog'] as { modules: { module: string; label: string; defaultHidden: boolean }[] }).modules
    .filter((module) => !module.defaultHidden)
  const pick = (name: string): { module: string; label: string } => {
    const found = catalog.find((module) => module.module === name)
    expect(found, `${name} in the catalog`).toBeTruthy()
    return found ?? { module: name, label: name }
  }
  const [first, second, third, fourth] = [pick('Contacts'), pick('Accounts'), pick('Potentials'), pick('Documents')]
  await patchGlobal(page, {
    'navigation.groups': [
      { id: 'mu16a', label: { '*': 'MU16 Alpha' }, icon: 'star', collapsed: false, items: [
        { type: 'module', module: first.module, label: null, icon: null },
        { type: 'module', module: 'NoSuchModule', label: null, icon: null },
      ] },
      { id: 'mu16b', label: { '*': 'MU16 Beta' }, icon: 'briefcase', collapsed: false, items: [
        { type: 'module', module: second.module, label: null, icon: null },
        { type: 'module', module: third.module, label: null, icon: null },
      ] },
    ],
  })
  await open(page, 'menu')
  await expect(page.locator('[data-mu-group-item]')).toHaveCount(2)
  const panel = page.locator('.mu-group[data-mu-group="mu16a"]')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.mu-item--unknown[data-mu-item="m:NoSuchModule"]')).toBeVisible()

  // Search over all groups, then the module in its group.
  await page.locator('[data-mu-field="module-search"]').fill(third.label)
  await expect(page.locator('[data-mu-list="search"]')).toContainText(third.label)
  await page.locator('[data-mu-list="search"] [data-mu-action="reveal"]').first().click()
  await expect(page.locator('.mu-group[data-mu-group="mu16b"]')).toBeVisible()
  await expect(page.locator(`[data-mu-row="mu16b/m:${third.module}"]`)).toBeFocused()
  await page.locator('[data-mu-field="module-search"]').fill('zzqq-no-such')
  await expect(page.locator('[data-mu-empty="search"]')).toBeVisible()
  await page.locator('[data-mu-field="module-search"]').fill('')

  // Keys: Alt+↑ moves the focused tile.
  await page.locator(`[data-mu-row="mu16b/m:${third.module}"]`).focus()
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.locator('.mu-group[data-mu-group="mu16b"] .mu-item').first()).toHaveAttribute('data-mu-item', `m:${third.module}`)

  // The menu of a tile: to another group.
  const tile = page.locator(`[data-mu-row="mu16b/m:${third.module}"]`)
  await tile.hover()
  await tile.locator('[data-mu-action="item-more"]').click()
  await page.locator('[data-mu-move-to="mu16a"]').click()
  await expect(page.locator('.mu-group[data-mu-group="mu16b"] .mu-item')).toHaveCount(1)

  // Drag and drop onto a group of the left column.
  await page.locator('[data-mu-row="group/mu16a"]').click()
  await expect(page.locator('.mu-group[data-mu-group="mu16a"] .mu-item')).toHaveCount(3)
  await page.locator(`[data-mu-row="mu16a/m:${third.module}"] .mu-tile__drag`).dragTo(page.locator('[data-mu-group-item="mu16b"]'))
  await expect(page.locator('.mu-group[data-mu-group="mu16a"] .mu-item')).toHaveCount(2)
  await page.locator('[data-mu-row="group/mu16b"]').click()
  await expect(page.locator(`.mu-group[data-mu-group="mu16b"] [data-mu-item="m:${third.module}"]`)).toBeVisible()

  // Adding from the catalog with its search.
  await page.locator('[data-mu-action="add-modules"]').click()
  await page.locator('[data-mu-field="picker-search"]').fill(fourth.label)
  await page.locator(`[data-mu-pick="${fourth.module}"]`).check()
  await page.locator('[data-mu-action="add-picked"]').click()
  await expect(page.locator(`.mu-group[data-mu-group="mu16b"] [data-mu-item="m:${fourth.module}"]`)).toBeVisible()

  // An empty group: shown as empty here, not shown in the menu.
  await page.locator('[data-mu-action="add-group"]').click()
  await page.locator('[data-mu-dialog="item"] [data-mu-label="*"]').fill('MU16 Leer')
  await page.locator('[data-mu-dialog="item"] [data-mu-action="dialog-save"]').click()
  await expect(page.locator('[data-mu-empty="group"]')).toBeVisible()
  await page.locator('[data-mu-action="menu-preview"]').click()
  await expect(page.locator('[data-mu-preview="menu"]')).toContainText('MU16 Beta')
  await expect(page.locator('[data-mu-preview="menu"]')).not.toContainText('MU16 Leer')
  await page.keyboard.press('Escape')
  await clickSave(page)

  // The real mega menu of a CRM page.
  await page.goto(HOME)
  await waitForShell(page)
  await page.locator('[data-mu-trigger="mega-menu"]').click()
  const mega = page.locator('[data-mu-panel="mega-menu"]')
  const sections = await mega.locator('[role="tab"]').allInnerTexts()
  expect(sections.join('|')).toContain('MU16 Alpha')
  expect(sections.join('|')).toContain('MU16 Beta')
  expect(sections.join('|')).not.toContain('MU16 Leer')
  await mega.locator('[role="tab"]').filter({ hasText: 'MU16 Beta' }).click()
  const beta = mega.locator('#mu-mega-panel')
  await expect(beta.locator(`[data-mu-item="m:${third.module}"]`)).toBeVisible()
  await expect(beta.locator(`[data-mu-item="m:${fourth.module}"]`)).toBeVisible()
  await mega.locator('[role="tab"]').filter({ hasText: 'MU16 Alpha' }).click()
  await expect(beta.locator(`[data-mu-item="m:${third.module}"]`)).toHaveCount(0)
  await expect(beta.locator('[data-mu-item="m:NoSuchModule"]')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await patchGlobal(page, { 'navigation.groups': original.values['navigation.groups'] ?? null })
})

test('personal preferences: only for this person, where each value comes from, favorites by keys and by drag', async ({ page }) => {
  await page.goto(HOME)
  await clearPersonal(page)
  await page.goto(PREFERENCES)
  const editor = page.locator('[data-mu-prefs]')
  await expect(editor.locator('[data-mu-prefs-scope]')).toBeVisible()
  await expect(page.locator('form.modernui-preferences-form')).toBeHidden()
  const density = editor.locator('[data-mu-key="appearance.density"]')
  await expect(density.locator('[data-mu-origin="inherited"]')).toBeVisible()
  await page.locator('[data-mu-field="density"]').selectOption('compact')
  await expect(density.locator('[data-mu-origin="own"]')).toBeVisible()
  const modules = ['Contacts', 'Accounts', 'Potentials']
  for (const module of modules) {
    await page.locator('[data-mu-field="favorite"]').selectOption(module)
    await page.locator('[data-mu-action="add-favorite"]').click()
  }
  const items = page.locator('[data-mu-list="favorites"] > li')
  await expect(items).toHaveCount(3)
  await page.locator('[data-mu-favorite="Potentials"]').focus()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(items.nth(1)).toHaveAttribute('data-mu-favorite', 'Potentials')
  await page.locator('[data-mu-favorite="Contacts"] .mu-favorite__drag').dragTo(page.locator('[data-mu-favorite="Accounts"]'))
  await expect(items.last()).not.toHaveAttribute('data-mu-favorite', 'Accounts')
  await page.locator('[data-mu-favorite="Accounts"]').focus()
  await page.keyboard.press('Delete')
  await expect(items).toHaveCount(2)
  const order = await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-mu-favorite')))
  await page.locator('[data-mu-footer] [data-mu-action="save"]').click()
  await expect(editor.locator('[data-mu-status].mu-text-success')).toBeVisible()
  const data = await bootstrap(page)
  expect((data['menu'] as { favorites: { id: string }[] }).favorites.map((item) => item.id)).toEqual(order.map((module) => `m:${module ?? ''}`))
  // The common settings did not change.
  expect((await globalScope(page)).values['appearance.density']).toEqual(original.values['appearance.density'])
  await page.locator('[data-mu-action="reset"]').click()
  await page.locator('[data-mu-dialog="confirm"] [data-mu-action="confirm-ok"]').click()
  await expect(editor.locator('[data-mu-status].mu-text-success')).toBeVisible()
  expect((await bootstrap(page))['personal']).toMatchObject({ values: {}, revision: 0 })
})

test('a restricted user: no administrator page, own preferences only, the administrator is not affected', async ({ browser, page }) => {
  test.skip(!isClean, 'users of other permissions exist on the clean stand only')
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 1000 }, storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  const limited = await context.newPage()
  await signIn(limited, cleanUserCredentials('limited'))
  await limited.goto(HOME)
  await clearPersonal(limited)
  await limited.goto(SETTINGS)
  await expect(limited.locator('.mu-editor')).toHaveCount(0)
  await expect(limited.locator('[data-mu-root="settings-editor"]')).toHaveCount(0)
  await limited.goto(PREFERENCES)
  await expect(limited.locator('[data-mu-prefs-scope]')).toBeVisible()
  await expect(limited.locator('[data-mu-scope], [data-mu-field="scope"], [data-mu-tab]')).toHaveCount(0)
  await limited.locator('[data-mu-field="density"]').selectOption('compact')
  await limited.locator('[data-mu-footer] [data-mu-action="save"]').click()
  await expect(limited.locator('[data-mu-status].mu-text-success')).toBeVisible()
  expect(((await bootstrap(limited))['appearance'] as { density: string }).density).toBe('compact')
  await page.goto(HOME)
  expect(((await bootstrap(page))['appearance'] as { density: string }).density).not.toBe('compact')
  await clearPersonal(limited)
  await context.close()
})

test('RU/EN/DE at 1440/1024/768/412 and 200 %: no overflow, the scope and the footer stay reachable', async ({ browser }) => {
  test.setTimeout(240_000)
  const sizes = [
    { width: 1440, height: 1000 }, { width: 1024, height: 900 }, { width: 768, height: 1024 }, { width: 412, height: 915 }, { width: 720, height: 500 },
  ]
  for (const locale of ['ru-RU', 'en-US', 'de-DE']) {
    for (const size of sizes) {
      const context = await adminContext(browser, size)
      const page = await context.newPage()
      page.on('dialog', (dialog) => {
        void dialog.accept()
      })
      if (size.width === 1440) {
        await page.goto(HOME)
        expect((await savePersonal(page, { locale })).ok).toBe(true)
      }
      for (const section of SECTIONS) {
        await open(page, section)
        const state = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          editor: (document.querySelector('.mu-editor')?.scrollWidth ?? 0) - (document.querySelector('.mu-editor')?.clientWidth ?? 0),
          lang: document.querySelector('.mu-editor')?.getAttribute('lang'),
        }))
        expect(state.lang, `${locale} ${String(size.width)} ${section}`).toBe(locale)
        expect(state.page, `${locale} ${String(size.width)} ${section}: page overflow`).toBeLessThanOrEqual(1)
        expect(state.editor, `${locale} ${String(size.width)} ${section}: editor overflow`).toBeLessThanOrEqual(1)
        const save = await page.locator('[data-mu-footer] [data-mu-action="save"]').boundingBox()
        expect((save?.y ?? 9999) + (save?.height ?? 0), `${locale} ${String(size.width)} ${section}: footer`).toBeLessThanOrEqual(size.height)
        if (['appearance', 'menu', 'compatibility'].includes(section)) {
          await expect(page.locator('[data-mu-field="scope"]')).toBeVisible()
        }
      }
      await context.close()
    }
  }
  const page = await adminPage(browser)
  await page.goto(HOME)
  await clearPersonal(page)
  if (Object.keys(originalPersonal).length > 0) {
    expect((await savePersonal(page, originalPersonal)).ok).toBe(true)
  }
  await page.context().close()
})

test('keyboard: tabs by arrows, the scope by keys, the footer in the tab order', async ({ page }) => {
  await open(page, 'enable')
  await page.locator('[data-mu-tab="enable"]').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[data-mu-tab="appearance"]')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-mu-tab="appearance"][data-state="active"]')).toBeVisible()
  await page.keyboard.press('End')
  await expect(page.locator('[data-mu-tab="maintenance"]')).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.locator('[data-mu-field="scope"]').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-mu-field="scope-search"]')).toBeFocused()
  const role = (await roleProfiles(page))[0]
  await page.keyboard.type((role?.name ?? '').slice(0, 4))
  await expect(page.locator(`[data-mu-panel="scope"] [data-mu-scope="${role?.id ?? ''}"]`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-mu-panel="scope"]')).toHaveCount(0)
  await expect(page.locator('[data-mu-field="scope"]')).toBeFocused()
  await page.locator('[data-mu-field="mu-primary"]').fill('#0b6e4f')
  // The footer follows the fields in the tab order of the page.
  await page.locator('[data-mu-footer] [data-mu-action="cancel"]').focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-mu-dirty]')).toHaveCount(0)
})

test('without JavaScript: the server page keeps the title, the status, the switches, the pilot and the recovery', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 1000 }, storageState: stateFile('admin'), javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(SETTINGS)
  await expect(page.locator('.modernui-page__title')).toHaveCount(1)
  await expect(page.locator('[data-mu-server="service"] table.modernui-status')).toBeVisible()
  await expect(page.locator('button[name="modernui-recovery"]')).toBeVisible()
  await expect(page.locator('[data-mu-fallback="link"] a[href*="editor=off"]')).toBeVisible()
  await page.goto(PREFERENCES)
  await expect(page.locator('form.modernui-preferences-form, [data-mu-fallback="preferences"]').first()).toBeVisible()
  await expect(page.locator('a[href*="modernui=off"]')).toBeVisible()
  await context.close()
})
