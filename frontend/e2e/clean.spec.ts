/**
 * ModernUI on the clean Vtiger 8.4.0 stand after the import of the ZIP through the Module Manager
 * (task clean:import-zip, then task test:e2e:clean). Users of dev/clean/tools/seed.php: A — admin, A2 — mu.admin2,
 * U — mu.limited (restricted profile, private records), G — mu.viewer (view all). Checks:
 *
 * - after the import the theme is off for everyone, no ModernUI resources on CRM pages (L1, L2; checked as is with
 *   MU_FRESH_IMPORT=1, otherwise after a reset); after a reinstall (MU_EXPECT_REINSTALL=1) the administrator sees
 *   the notice and the kept pilot list (L8);
 * - the settings item exists in Settings → Other settings and is highlighted (Q5);
 * - "Enable for me": A gets the theme, A2, U and G do not (T1);
 * - pilot by user: U gets the theme at once — no privilege files are rebuilt (Q2) — on core screens and on the
 *   screens of the test entity module "Gadgets" ModernUI knows nothing about; G and A2 are untouched (T2);
 * - pilot by role: G through the role "MU Viewer";
 * - theme texts in RU/EN/DE on a CRM that has en_us only, "As in the CRM" falls back to English (I1);
 * - U cannot open or post to the administrator pages of ModernUI (P6);
 * - Settings → Module Manager: disable removes the theme for A and U at once, enable brings it back with the
 *   settings kept (L3, L4, Q3);
 * - no request leaves the CRM host, no dev server or repository paths in the requests (X7).
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { adminCredentials, cleanUserCredentials, crmUrl, isClean, type CleanUser } from './env'
import {
  HOME, PREFERENCES_FORM, SETTINGS, SETTINGS_FORMS, isolateNetwork, setModuleActive, signIn, themeOnPage, waitForShell,
} from './support'

test.describe.configure({ mode: 'serial' })
test.skip(!isClean, 'clean stand only (MU_E2E_TARGET=c81|c85)')

const requests: string[] = []
const blocked: string[] = []

interface Session {
  context: BrowserContext
  page: Page
}

async function session(browser: Browser, user: CleanUser | 'admin'): Promise<Session> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } })
  blocked.push(...(await isolateNetwork(context)))
  context.on('request', (request) => requests.push(request.url()))
  const page = await context.newPage()
  await signIn(page, user === 'admin' ? adminCredentials() : cleanUserCredentials(user))
  return { context, page }
}

async function themeActive(page: Page, url = HOME): Promise<boolean> {
  await page.goto(url)
  const state = await themeOnPage(page)
  if (state.loader === 0) {
    expect(state.skin, `${url}: skin without loader`).toBe(0)
    expect(state.tokens, `${url}: tokens without loader`).toBe(0)
    return false
  }
  await waitForShell(page)
  const after = await themeOnPage(page)
  expect(after, url).toEqual({ skin: 1, tokens: 1, loader: 1, ready: true, failed: null })
  return true
}

async function settingsForm(page: Page, button: string, field?: { name: string; value: string }): Promise<void> {
  await page.goto(SETTINGS_FORMS)
  const form = page.locator(`form:has(button[name="${button}"])`).filter(field === undefined ? {} : { has: page.locator(`[name="${field.name}"]`) })
  if (field !== undefined) {
    await form.locator(`select[name="${field.name}"]`).selectOption(field.value)
  }
  await Promise.all([page.waitForURL(/result=/), form.locator(`button[name="${button}"]`).first().click()])
}

/** Removes every user and role from the pilot and switches the theme off for everyone. */
async function resetTheme(page: Page): Promise<void> {
  await page.goto(SETTINGS_FORMS)
  for (const kind of ['user', 'role']) {
    while ((await page.locator(`button[name="modernui-pilot-remove-${kind}"]:visible`).count()) > 0) {
      await Promise.all([page.waitForURL(/result=/), page.locator(`button[name="modernui-pilot-remove-${kind}"]`).first().click()])
    }
  }
  if ((await page.locator('button[name="modernui-disable-for-all"]').count()) > 0) {
    await Promise.all([page.waitForURL(/result=/), page.locator('button[name="modernui-disable-for-all"]').click()])
  }
}

async function optionValue(page: Page, select: string, label: RegExp): Promise<string> {
  await page.goto(SETTINGS_FORMS)
  const option = page.locator(`${select} option`).filter({ hasText: label })
  await expect(option).toHaveCount(1)
  return (await option.getAttribute('value')) ?? ''
}

let admin: Session
let limited: Session
let viewer: Session
let admin2: Session

test.beforeAll(async ({ browser }) => {
  admin = await session(browser, 'admin')
  limited = await session(browser, 'limited')
  viewer = await session(browser, 'viewer')
  admin2 = await session(browser, 'admin2')
  await setModuleActive(admin.page, 'ModernUI', true)
})

test.afterAll(async () => {
  for (const s of [admin, limited, viewer, admin2]) {
    await s.context.close()
  }
})

test('after the import (or a reset): theme off for everyone, no ModernUI resources on CRM pages', async () => {
  // Right after an import (MU_FRESH_IMPORT=1, task clean:verify) the state must be "off" by itself; on a stand
  // used before, the scenario first switches the theme off and empties the pilot.
  const fresh = process.env['MU_FRESH_IMPORT'] === '1' || process.env['MU_EXPECT_REINSTALL'] === '1'
  if (!fresh) {
    await resetTheme(admin.page)
  }
  if (process.env['MU_EXPECT_REINSTALL'] === '1') {
    // Reinstall over kept settings (L8): notice for the administrator, the saved pilot list is still there.
    await admin.page.goto(SETTINGS_FORMS)
    await expect(admin.page.locator('.alert-info')).toHaveCount(1)
    await expect(admin.page.locator('tr[data-mu-pilot-user]')).not.toHaveCount(0)
  }
  for (const s of [admin, limited, viewer, admin2]) {
    for (const url of [HOME, 'index.php?module=Accounts&view=List', 'index.php?module=Gadgets&view=List']) {
      expect(await themeActive(s.page, url), url).toBe(false)
    }
  }
  await resetTheme(admin.page)
})

test('settings: the item in Settings → Other settings opens the page and is highlighted', async () => {
  const page = admin.page
  await page.goto('index.php?module=Vtiger&parent=Settings&view=Index')
  const item = page.locator('a.menuItemLabel[data-name="ModernUI"]')
  await expect(item).toHaveCount(1)
  await page.goto((await item.getAttribute('href')) ?? SETTINGS)
  await expect(page.locator('table.modernui-status')).toBeVisible()
  await expect(page.locator('a.menuItemLabel.settingsgroup-menu-color[data-name="ModernUI"]')).toHaveCount(1)
  await expect(page.locator('#LBL_OTHER_SETTINGS.in')).toHaveCount(1)
  await expect(page.locator('.modernui-pilot select#modernui-pilot-user option')).not.toHaveCount(0)
})

test('enable for me: the administrator only', async () => {
  await settingsForm(admin.page, 'modernui-enable-for-me')
  await expect(admin.page.locator('.alert-success')).toBeVisible()
  expect(await themeActive(admin.page)).toBe(true)
  for (const s of [admin2, limited, viewer]) {
    expect(await themeActive(s.page)).toBe(false)
  }
})

test('pilot by user: the restricted user gets the theme on core and custom module screens, others do not', async () => {
  const id = await optionValue(admin.page, 'select#modernui-pilot-user', /mu\.limited/)
  await settingsForm(admin.page, 'modernui-pilot-add-user', { name: 'user', value: id })
  await expect(admin.page.locator('.alert-success')).toBeVisible()
  await expect(admin.page.locator(`tr[data-mu-pilot-user="${id}"]`)).toHaveCount(1)
  for (const url of [HOME, 'index.php?module=Accounts&view=List', 'index.php?module=SalesOrder&view=List',
    'index.php?module=Gadgets&view=List', 'index.php?module=Calendar&view=Calendar']) {
    expect(await themeActive(limited.page, url), url).toBe(true)
  }
  // The detail view of a record of the entity module ModernUI does not know.
  await limited.page.goto('index.php?module=Gadgets&view=List')
  const record = await limited.page.locator('tr.listViewEntries[data-id]').first().getAttribute('data-id')
  expect(record).not.toBeNull()
  expect(await themeActive(limited.page, `index.php?module=Gadgets&view=Detail&record=${record ?? ''}`)).toBe(true)
  // The restricted profile still decides what U sees.
  await limited.page.goto('index.php?module=Leads&view=List')
  await expect(limited.page.locator('body')).toContainText(/permission denied/i)
  for (const s of [admin2, viewer]) {
    expect(await themeActive(s.page)).toBe(false)
  }
})

test('pilot by role: the user of the role gets the theme, removing the role takes it away', async () => {
  const role = await optionValue(admin.page, 'select#modernui-pilot-role', /^MU Viewer$/)
  await settingsForm(admin.page, 'modernui-pilot-add-role', { name: 'role', value: role })
  expect(await themeActive(viewer.page)).toBe(true)
  expect(await themeActive(admin2.page)).toBe(false)
  await admin.page.goto(SETTINGS_FORMS)
  await Promise.all([admin.page.waitForURL(/result=pilot_removed/),
    admin.page.locator(`tr[data-mu-pilot-role="${role}"] button[name="modernui-pilot-remove-role"]`).click()])
  expect(await themeActive(viewer.page)).toBe(false)
})

test('languages: theme texts in RU/EN/DE on a CRM with en_us only, "As in the CRM" is English', async () => {
  const page = limited.page
  const expected: Record<string, { saved: string; menu: string }> = {
    'ru-RU': { saved: 'Предпочтения сохранены.', menu: 'Новый интерфейс' },
    'de-DE': { saved: 'Ihre Einstellungen wurden gespeichert.', menu: 'Neue Oberfläche' },
    'en-US': { saved: 'Your preferences have been saved.', menu: 'New interface' },
    auto: { saved: 'Your preferences have been saved.', menu: 'New interface' },
  }
  for (const [locale, texts] of Object.entries(expected)) {
    await page.goto(PREFERENCES_FORM)
    await page.locator('#modernui-locale').selectOption(locale)
    await Promise.all([page.waitForURL(/result=saved/), page.locator('form.modernui-preferences-form button[type="submit"]').click()])
    await expect(page.locator('.alert-success')).toHaveText(texts.saved)
    expect(await themeActive(page)).toBe(true)
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-mu-locale'))).toBe(locale === 'auto' ? 'en-US' : locale)
    await page.locator('[data-mu-root="system-menu"] .mu-system-menu__trigger').click()
    await expect(page.locator('#mu-overlay-root .mu-menu__label')).toHaveText(texts.menu)
    // No raw keys or empty entries in the menu of the theme.
    const items = await page.locator('#mu-overlay-root .mu-menu [data-mu-item]').allInnerTexts()
    expect(items.length).toBeGreaterThan(2)
    for (const item of items) {
      expect(item.trim()).not.toBe('')
      expect(item).not.toMatch(/\b(LBL|MU)_[A-Z_]+\b|\bmenu\.[a-z]/)
    }
    await page.keyboard.press('Escape')
  }
  // The CRM itself stays in English: the theme language changes only the texts of the theme.
  await page.goto(HOME)
  expect(await page.evaluate(() => document.documentElement.getAttribute('lang') ?? '')).not.toMatch(/^(ru|de)/)
})

test('a restricted user cannot open or post to the administrator pages of ModernUI', async () => {
  const page = limited.page
  await page.goto(SETTINGS)
  await expect(page.locator('table.modernui-status')).toHaveCount(0)
  await expect(page.locator('body')).toContainText(/permission denied/i)
  await page.goto(PREFERENCES_FORM)
  const token = await page.locator('form.modernui-preferences-form input[name="__vtrftk"]').first().getAttribute('value')
  const response = await page.request.post('index.php', {
    form: { module: 'ModernUI', parent: 'Settings', action: 'Toggle', mode: 'disableForAll', __vtrftk: token ?? '' },
    headers: { Referer: `${crmUrl()}index.php` },
  })
  expect(await response.text()).toMatch(/permission denied/i)
  expect(await themeActive(admin.page)).toBe(true)
})

test('Module Manager: disable takes the theme away from everyone, enable brings it back with the settings kept', async () => {
  await setModuleActive(admin.page, 'ModernUI', false)
  expect(await themeActive(admin.page)).toBe(false)
  expect(await themeActive(limited.page)).toBe(false)
  await admin.page.goto(`${SETTINGS}#mu-maintenance`)
  await expect(admin.page.locator('table.modernui-status')).toBeVisible()
  await setModuleActive(admin.page, 'ModernUI', true)
  expect(await themeActive(admin.page)).toBe(true)
  expect(await themeActive(limited.page)).toBe(true)
  expect(await themeActive(viewer.page)).toBe(false)
})

test('standard view and safe mode of the restricted user', async () => {
  const page = limited.page
  await page.goto(PREFERENCES_FORM)
  await page.locator('input[type="checkbox"][name="standardView"]').check()
  await Promise.all([page.waitForURL(/result=saved/), page.locator('form.modernui-preferences-form button[type="submit"]').click()])
  expect(await themeActive(page)).toBe(false)
  await page.goto(PREFERENCES_FORM)
  await page.locator('input[type="checkbox"][name="standardView"]').uncheck()
  await Promise.all([page.waitForURL(/result=saved/), page.locator('form.modernui-preferences-form button[type="submit"]').click()])
  expect(await themeActive(page)).toBe(true)
  await page.goto('index.php?modernui=off')
  expect(await themeActive(page)).toBe(false)
  await page.goto('index.php?modernui=on')
  expect(await themeActive(page)).toBe(true)
})

test('network: every request stays on the CRM host, no dev server or repository paths', () => {
  const own = new URL(crmUrl()).host
  expect(blocked).toEqual([])
  const foreign = requests.filter((url) => url.startsWith('http') && new URL(url).host !== own)
  expect(foreign).toEqual([])
  const dev = requests.filter((url) => /localhost|:5173|\/@vite|\/frontend\/|\/src\/|node_modules/.test(url))
  expect(dev).toEqual([])
  const theme = requests.filter((url) => url.includes('/modules/ModernUI/'))
  expect(theme.length).toBeGreaterThan(0)
})
