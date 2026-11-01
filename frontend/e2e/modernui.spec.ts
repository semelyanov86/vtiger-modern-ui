/**
 * Stage 02 browser checks on a Vtiger 8.4 instance with ModernUI registered (task crm:install):
 * settings page and frontend check, theme off by default, "enable for me", loader and shell on real pages,
 * system menu (mouse and keyboard), RU/EN/DE of the theme texts, safe mode, standard view with in-place
 * teardown, failures of the frontend that must leave the v7 interface working, "disable for me".
 */
import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const SETTINGS = 'index.php?module=ModernUI&parent=Settings&view=Index'
const PREFERENCES = 'index.php?module=ModernUI&view=Preferences'
const HOME = 'index.php?module=Home&view=DashBoard'

const SKIN = 'link[rel="stylesheet"][href*="modules/ModernUI/resources/dist/assets/skin-"]'
const LOADER = 'script[src*="modules/ModernUI/resources/loader.js"]'
const ISLAND = '#navbar > [data-mu-root="system-menu"]'

/** Warnings of ModernUI in the browser console ("[ModernUI] …") and uncaught page errors. */
function watchConsole(page: Page): string[] {
  const messages: string[] = []
  page.on('console', (message) => {
    if (message.text().includes('[ModernUI]')) {
      messages.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => {
    if (/ModernUI|modernui|mu-/.test(`${error.message} ${error.stack ?? ''}`)) {
      messages.push(`pageerror: ${error.message}`)
    }
  })
  return messages
}

async function themeOnPage(page: Page): Promise<{ skin: number; loader: number; ready: boolean; failed: string | null }> {
  return {
    skin: await page.locator(SKIN).count(),
    loader: await page.locator(LOADER).count(),
    ready: await page.evaluate(() => document.documentElement.classList.contains('mu-shell-ready')),
    failed: await page.evaluate(() => document.documentElement.getAttribute('data-mu-failed')),
  }
}

async function waitForShell(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const html = document.documentElement
    return html.classList.contains('mu-shell-ready') || html.hasAttribute('data-mu-failed')
  })
}

async function settingsAction(page: Page, button: string): Promise<void> {
  await page.goto(SETTINGS)
  await Promise.all([page.waitForURL(/result=/), page.locator(`button[name="${button}"]`).click()])
}

async function savePreferences(page: Page, change: (page: Page) => Promise<void>): Promise<void> {
  await page.goto(PREFERENCES)
  await change(page)
  await Promise.all([page.waitForURL(/result=saved/), page.locator('form.modernui-preferences-form button[type="submit"]').click()])
}

test('initial state: theme off for everyone, nothing of ModernUI on CRM pages', async ({ page }) => {
  await page.goto(SETTINGS)
  // Leave a known state: theme off, no personal preferences of the administrator.
  if ((await page.locator('button[name="modernui-disable-for-all"]').count()) > 0) {
    await settingsAction(page, 'modernui-disable-for-all')
  }
  await page.goto(PREFERENCES)
  if ((await page.locator('form.modernui-reset-form button').count()) > 0) {
    await Promise.all([page.waitForURL(/result=reset/), page.locator('form.modernui-reset-form button').click()])
  }
  await page.goto(HOME)
  expect(await themeOnPage(page)).toEqual({ skin: 0, loader: 0, ready: false, failed: null })
})

test('settings page: status, links, schema and the frontend check of this browser', async ({ page }) => {
  const consoleMessages = watchConsole(page)
  await page.goto(SETTINGS)
  const status = page.locator('table.modernui-status')
  await expect(status).toBeVisible()
  await expect(status.locator('code').first()).toHaveText(/^[0-9a-f]{12}$/)
  const build = await page.locator('[data-mu-root="settings-diagnostics"]').getAttribute('data-mu-build')
  expect(build).toMatch(/^[0-9a-f]{12}$/)
  // The island replaces the server text once the settings entry has loaded and checked Bootstrap.
  const diagnostics = page.locator('.mu-diagnostics')
  await expect(diagnostics).toBeVisible()
  await expect(diagnostics.locator('.mu-diagnostics__line--ok')).toContainText(build ?? 'missing')
  await expect(diagnostics.locator('.mu-diagnostics__line--warn')).toHaveCount(0)
  // The settings page works without JavaScript: the switches are plain forms.
  await expect(page.locator('button[name="modernui-enable-for-me"]')).toBeVisible()
  await expect(page.locator('button[name="modernui-recovery"]')).toBeVisible()
  expect(consoleMessages).toEqual([])
})

test('enable for me: skin, loader and shell on CRM pages, host globals untouched', async ({ page }) => {
  const consoleMessages = watchConsole(page)
  await settingsAction(page, 'modernui-enable-for-me')
  await expect(page.locator('.alert-success')).toBeVisible()
  await page.goto(HOME)
  await waitForShell(page)
  expect(await themeOnPage(page)).toEqual({ skin: 1, loader: 1, ready: true, failed: null })

  const loaderSrc = (await page.locator(LOADER).getAttribute('src')) ?? ''
  expect(loaderSrc).toMatch(/loader\.js\?b=[0-9a-f]{12}&r=[0-9a-f]{12}&z=\?v=8\.4/)
  const skinHref = (await page.locator(SKIN).getAttribute('href')) ?? ''
  expect(skinHref).toMatch(/skin-[A-Za-z0-9_-]+\.css\?b=[0-9a-f]{12}&z=\?v=8\.4/)
  // The skin comes after the v7 theme and before any content. (Header.tpl of 8.4.0 prints
  // <input id="inventoryModules"> inside <head>, so the parser moves the theme and all HEADERCSS links to
  // the start of <body>: still before the content, still render-blocking.)
  const order = await page.evaluate((skinSelector) => {
    const skin = document.querySelector(skinSelector)
    const theme = document.querySelector('link[href*="layouts/v7/skins/"][href*="/style.css"]')
    const nav = document.querySelector('nav.app-fixed-navbar')
    if (skin === null || theme === null || nav === null) {
      return 'missing'
    }
    const afterTheme = (theme.compareDocumentPosition(skin) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    const beforeNav = (skin.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    return afterTheme && beforeNav ? 'ok' : 'wrong order'
  }, SKIN)
  expect(order).toBe('ok')

  // Own container next to the v7 actions, not inside a foreign <ul>.
  await expect(page.locator(ISLAND)).toHaveCount(1)
  expect(await page.locator('#navbar ul [data-mu-root]').count()).toBe(0)
  await expect(page.locator('#navbar ul.nav.navbar-nav > li').first()).toBeVisible()

  const globals = await page.evaluate(() => {
    const win = window as unknown as Record<string, unknown>
    const vue = win['Vue'] as { version?: unknown } | undefined
    return {
      sameJQuery: win['jQuery'] === win['$'] && typeof win['jQuery'] === 'function',
      vue3Global: typeof vue === 'object' && typeof vue.version === 'string' && vue.version.startsWith('3.'),
      locale: document.documentElement.getAttribute('data-mu-locale'),
      pending: document.documentElement.classList.contains('mu-pending'),
      tokens: getComputedStyle(document.documentElement).getPropertyValue('--mu-primary-strong').trim(),
    }
  })
  expect(globals.sameJQuery).toBe(true)
  expect(globals.vue3Global).toBe(false)
  expect(globals.locale).toMatch(/^(ru-RU|en-US|de-DE)$/)
  expect(globals.pending).toBe(false)
  expect(globals.tokens).toMatch(/^#[0-9a-f]{6}$/)
  expect(consoleMessages).toEqual([])
})

test('system menu: mouse and keyboard, entries of an administrator', async ({ page }) => {
  await page.goto(HOME)
  await waitForShell(page)
  const trigger = page.locator(`${ISLAND} .mu-system-menu__trigger`)
  await trigger.click()
  const menu = page.locator('#mu-overlay-root .mu-menu')
  await expect(menu).toBeVisible()
  for (const id of ['preferences', 'standardView', 'safeMode', 'moduleSettings', 'crmSettings']) {
    await expect(menu.locator(`[data-mu-item="${id}"]`)).toBeVisible()
  }
  // Nothing of the fixed v7 header covers the menu (stacking order, not only CSS visibility).
  const covered = await page.evaluate(() => {
    const label = document.querySelector('#mu-overlay-root .mu-menu__label')
    if (label === null) {
      return 'no label'
    }
    const box = label.getBoundingClientRect()
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return hit !== null && label.contains(hit) ? 'visible' : `covered by ${hit?.className ?? 'nothing'}`
  })
  expect(covered).toBe('visible')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(menu.locator('[data-highlighted]')).toHaveCount(1)
  await page.keyboard.press('Escape')

  await trigger.click()
  await Promise.all([page.waitForURL(/module=ModernUI&view=Preferences/), menu.locator('[data-mu-item="preferences"]').click()])
  await expect(page.locator('form.modernui-preferences-form')).toBeVisible()
})

test('languages: the theme texts follow the personal choice RU/EN/DE, English is the fallback', async ({ page }) => {
  const expected: Record<string, { pref: string; menu: string }> = {
    'de-DE': { pref: 'Ihre Einstellungen wurden gespeichert.', menu: 'Neue Oberfläche' },
    'en-US': { pref: 'Your preferences have been saved.', menu: 'New interface' },
    'ru-RU': { pref: 'Предпочтения сохранены.', menu: 'Новый интерфейс' },
  }
  for (const [locale, texts] of Object.entries(expected)) {
    await savePreferences(page, async (p) => {
      await p.locator('#modernui-locale').selectOption(locale)
    })
    await expect(page.locator('.alert-success')).toHaveText(texts.pref)
    await page.goto(HOME)
    await waitForShell(page)
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-mu-locale'))).toBe(locale)
    await page.locator(`${ISLAND} .mu-system-menu__trigger`).click()
    await expect(page.locator('#mu-overlay-root .mu-menu__label')).toHaveText(texts.menu)
    await page.keyboard.press('Escape')
  }
  await savePreferences(page, async (p) => {
    await p.locator('#modernui-locale').selectOption('auto')
  })
})

test('safe mode: ?modernui=off stops the theme for the session, ?modernui=on brings it back', async ({ page }) => {
  await page.goto('index.php?modernui=off')
  await page.waitForSelector('#navbar')
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, loader: 0 })
  await page.goto(HOME)
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, loader: 0 })
  await page.goto(PREFERENCES)
  await expect(page.locator('a[href*="modernui=on"]')).toBeVisible()
  await page.goto(`${PREFERENCES}&modernui=on`)
  await page.goto(HOME)
  await waitForShell(page)
  expect(await themeOnPage(page)).toEqual({ skin: 1, loader: 1, ready: true, failed: null })
})

test('failures keep the standard interface: blocked entry, broken manifest, Bootstrap error', async ({ page }) => {
  const cases: { name: string; route: string; fulfil: 'abort' | number; failed: RegExp }[] = [
    { name: 'entry', route: '**/modules/ModernUI/resources/dist/assets/shell-*.js', fulfil: 'abort', failed: /^entry-load$/ },
    { name: 'manifest', route: '**/modules/ModernUI/resources/dist/manifest.json*', fulfil: 404, failed: /^manifest-invalid$/ },
    { name: 'bootstrap', route: '**/index.php?module=ModernUI&action=Bootstrap*', fulfil: 500, failed: /^MU_BAD_RESPONSE$/ },
  ]
  for (const failure of cases) {
    await page.route(failure.route, async (route) => {
      if (failure.fulfil === 'abort') {
        await route.abort()
      } else {
        await route.fulfill({ status: failure.fulfil, contentType: 'text/html', body: '<html><body>error</body></html>' })
      }
    })
    await page.goto(HOME)
    await waitForShell(page)
    const state = await themeOnPage(page)
    expect(state.ready, failure.name).toBe(false)
    expect(state.failed ?? '', failure.name).toMatch(failure.failed)
    expect(await page.evaluate(() => document.documentElement.classList.contains('mu-pending')), failure.name).toBe(false)
    await expect(page.locator(ISLAND), failure.name).toHaveCount(0)
    // v7 keeps working: the app menu and the header actions respond.
    await expect(page.locator('#navbar ul.nav.navbar-nav > li').first()).toBeVisible()
    await page.locator('#appnavigator').click()
    await expect(page.locator('#app-menu')).toBeVisible()
    await page.unroute(failure.route)
  }
})

test('standard view from the system menu: in-place teardown, kept after reload, reversible', async ({ page }) => {
  await page.goto(HOME)
  await waitForShell(page)
  await page.locator(`${ISLAND} .mu-system-menu__trigger`).click()
  await page.locator('#mu-overlay-root [data-mu-item="standardView"]').click()
  await expect(page.locator(ISLAND)).toHaveCount(0)
  const after = await page.evaluate(() => ({
    off: document.documentElement.classList.contains('mu-off'),
    ready: document.documentElement.classList.contains('mu-shell-ready'),
    overlay: document.getElementById('mu-overlay-root') !== null,
  }))
  expect(after).toEqual({ off: true, ready: false, overlay: false })
  await expect(page.locator(SKIN)).toHaveCount(0)

  await page.goto(HOME)
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, loader: 0 })
  await page.goto(PREFERENCES)
  await expect(page.locator('input[type="checkbox"][name="standardView"]')).toBeChecked()
  await savePreferences(page, async (p) => {
    await p.locator('input[type="checkbox"][name="standardView"]').uncheck()
  })
  await page.goto(HOME)
  await waitForShell(page)
  expect(await themeOnPage(page)).toEqual({ skin: 1, loader: 1, ready: true, failed: null })
})

test('disable for me and enable again: the theme follows the pilot list', async ({ page }) => {
  await settingsAction(page, 'modernui-disable-for-me')
  await page.goto(HOME)
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, loader: 0 })
  await settingsAction(page, 'modernui-enable-for-me')
  await page.goto(HOME)
  await waitForShell(page)
  expect(await themeOnPage(page)).toEqual({ skin: 1, loader: 1, ready: true, failed: null })
})
