/**
 * Browser checks on a Vtiger 8.4 instance with ModernUI registered (stage 02; dev instance: task crm:install,
 * clean stand: task clean:import-zip):
 * settings page and frontend check, theme off by default, "enable for me", loader and shell on real pages,
 * system menu (mouse and keyboard), RU/EN/DE of the theme texts, safe mode, standard view with in-place
 * teardown, failures of the frontend that must leave the v7 interface working, "disable for me".
 */
import { expect, test, type Page } from '@playwright/test'
import { isClean } from './env'
import { HOME, ISLAND, LOADER, PREFERENCES, PREFERENCES_FORM, SETTINGS, SKIN, TOKENS, isolateNetwork, themeOnPage, waitForShell } from './support'

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ context }) => {
  // The clean stand must not reach the internet (no-op on the dev instance).
  await isolateNetwork(context)
})

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

async function settingsAction(page: Page, button: string): Promise<void> {
  await page.goto(SETTINGS)
  await Promise.all([page.waitForURL(/result=/), page.locator(`button[name="${button}"]`).click()])
}

async function savePreferences(page: Page, change: (page: Page) => Promise<void>): Promise<void> {
  await page.goto(PREFERENCES_FORM)
  await change(page)
  await Promise.all([page.waitForURL(/result=saved/), page.locator('form.modernui-preferences-form button[type="submit"]').click()])
}

test('initial state: theme off for everyone, nothing of ModernUI on CRM pages', async ({ page }) => {
  await page.goto(SETTINGS)
  // Leave a known state: theme off, no personal preferences of the administrator.
  if ((await page.locator('button[name="modernui-disable-for-all"]').count()) > 0) {
    await settingsAction(page, 'modernui-disable-for-all')
  }
  await page.goto(PREFERENCES_FORM)
  if ((await page.locator('form.modernui-reset-form button').count()) > 0) {
    await Promise.all([page.waitForURL(/result=reset/), page.locator('form.modernui-reset-form button').click()])
  }
  await page.goto(HOME)
  expect(await themeOnPage(page)).toEqual({ skin: 0, tokens: 0, loader: 0, ready: false, failed: null })
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
  expect(await themeOnPage(page)).toEqual({ skin: 1, tokens: 1, loader: 1, ready: true, failed: null })

  const loaderSrc = (await page.locator(LOADER).getAttribute('src')) ?? ''
  expect(loaderSrc).toMatch(/loader\.js\?b=[0-9a-f]{12}&z=\?v=8\.4/)
  const tokensHref = (await page.locator(TOKENS).getAttribute('href')) ?? ''
  expect(tokensHref).toMatch(/^index\.php\?module=ModernUI&action=Tokens&r=[0-9a-f]{12}&z=\?v=8\.4/)
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
  // The editor of the preferences replaces the server form (still on the page, hidden).
  await expect(page.locator('[data-mu-prefs]')).toBeVisible()
  await expect(page.locator('form.modernui-preferences-form')).toBeHidden()
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
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, tokens: 0, loader: 0 })
  await page.goto(HOME)
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, tokens: 0, loader: 0 })
  await page.goto(PREFERENCES)
  await expect(page.locator('a[href*="modernui=on"]')).toBeVisible()
  await page.goto(`${PREFERENCES}&modernui=on`)
  await page.goto(HOME)
  await waitForShell(page)
  expect(await themeOnPage(page)).toEqual({ skin: 1, tokens: 1, loader: 1, ready: true, failed: null })
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
  await expect(page.locator(TOKENS)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--mu-primary'))).toBe('')

  await page.goto(HOME)
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, tokens: 0, loader: 0 })
  await page.goto(PREFERENCES_FORM)
  await expect(page.locator('input[type="checkbox"][name="standardView"]')).toBeChecked()
  await savePreferences(page, async (p) => {
    await p.locator('input[type="checkbox"][name="standardView"]').uncheck()
  })
  await page.goto(HOME)
  await waitForShell(page)
  expect(await themeOnPage(page)).toEqual({ skin: 1, tokens: 1, loader: 1, ready: true, failed: null })
})

test('disable for me and enable again: the theme follows the pilot list', async ({ page }) => {
  await settingsAction(page, 'modernui-disable-for-me')
  await page.goto(HOME)
  expect(await themeOnPage(page)).toMatchObject({ skin: 0, tokens: 0, loader: 0 })
  await settingsAction(page, 'modernui-enable-for-me')
  await page.goto(HOME)
  await waitForShell(page)
  expect(await themeOnPage(page)).toEqual({ skin: 1, tokens: 1, loader: 1, ready: true, failed: null })
})

const LIST = 'index.php?module=Accounts&view=List'

test('tokens: the personal density and text size reach the first paint through the tokens stylesheet', async ({ page }) => {
  await savePreferences(page, async (p) => {
    await p.locator('#modernui-density').selectOption('compact')
    await p.locator('#modernui-font-scale').selectOption('110')
  })
  // Without the shell nothing sets inline tokens: what the page shows comes from the server stylesheet alone.
  const shell = '**/modules/ModernUI/resources/dist/assets/shell-*.js'
  await page.route(shell, (route) => route.abort())
  await page.goto(LIST)
  const early = await page.evaluate(() => {
    const html = getComputedStyle(document.documentElement)
    return {
      row: html.getPropertyValue('--mu-row-height').trim(),
      scale: html.getPropertyValue('--mu-font-scale').trim(),
      inline: document.documentElement.style.getPropertyValue('--mu-row-height'),
      body: getComputedStyle(document.body).fontSize,
    }
  })
  expect(early).toEqual({ row: '32px', scale: '1.1', inline: '', body: '14.3px' })
  await page.unroute(shell)

  // The shell confirms the same values; the stylesheet of this settings revision comes from the browser cache.
  const tokensUrl = new URL((await page.locator(TOKENS).getAttribute('href')) ?? '', page.url()).toString()
  const answer = await page.request.get(tokensUrl)
  expect(answer.headers()['cache-control']).toBe('private, max-age=31536000, immutable')
  expect(answer.headers()['content-type']).toMatch(/^text\/css/)
  await page.goto(LIST)
  await waitForShell(page)
  const confirmed = await page.evaluate((url) => {
    const entry = performance.getEntriesByName(url)[0] as PerformanceResourceTiming | undefined
    return {
      inline: document.documentElement.style.getPropertyValue('--mu-row-height'),
      cached: entry === undefined ? 'no entry' : entry.transferSize === 0,
    }
  }, tokensUrl)
  expect(confirmed.inline).toBe('32px')
  // Request interception disables the HTTP cache of Playwright; the clean stand intercepts every request of the
  // context (isolateNetwork), so the cache itself is checked on the dev instance (headers are checked everywhere).
  if (!isClean) {
    expect(confirmed.cached).toBe(true)
  }
  // A stale key (an old page) gets the current values, but never cached.
  const stale = await page.request.get('index.php?module=ModernUI&action=Tokens&r=000000000000&z=')
  expect(stale.headers()['cache-control']).toBe('private, no-store')
  expect(await stale.text()).toContain('--mu-row-height:32px')

  await savePreferences(page, async (p) => {
    await p.locator('#modernui-density').selectOption('')
    await p.locator('#modernui-font-scale').selectOption('')
  })
  await page.goto(LIST)
  await waitForShell(page)
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--mu-row-height').trim())).toBe('40px')
})

test('runtime: one island after PJAX reloads of the list, a re-rendered header and a second loader', async ({ page }) => {
  const consoleMessages = watchConsole(page)
  await page.goto(LIST)
  await waitForShell(page)
  await expect(page.locator(ISLAND)).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-mu-level'))).toBe('islands')

  // PJAX reload of the list by v7 (search row): nothing of the islands changes.
  const firstColumn = page.locator('tr.searchRow input.listSearchContributor').first()
  if ((await firstColumn.count()) > 0) {
    for (const value of ['a', '']) {
      await firstColumn.fill(value)
      // Enter in a search field of the list makes v7 reload the list content (app.request.pjax).
      const reloaded = page.waitForResponse((response) => response.url().includes('index.php')
        && `${response.url()} ${response.request().postData() ?? ''}`.includes('view=List')
        && (response.request().headers()['x-pjax'] !== undefined || response.request().headers()['x-requested-with'] !== undefined))
      await firstColumn.press('Enter')
      expect((await reloaded).status()).toBe(200)
      await expect(page.locator('tr.searchRow input.listSearchContributor').first()).toBeAttached()
      await page.waitForTimeout(300)
    }
  }
  await expect(page.locator(ISLAND)).toHaveCount(1)

  // A part of the header re-rendered (as PJAX or an extension would do): the island comes back once.
  await page.evaluate(() => document.querySelector('[data-mu-root="system-menu"]')?.remove())
  await expect(page.locator(ISLAND)).toHaveCount(1)

  // A second copy of the loader and of the shell entry: no second shell, no second island or overlay root.
  await page.evaluate(async () => {
    const loader = document.querySelector<HTMLScriptElement>('script[src*="modules/ModernUI/resources/loader.js"]')
    const shell = document.querySelector<HTMLScriptElement>('script[type="module"][data-mu-asset="shell"]')
    if (loader !== null) {
      const copy = document.createElement('script')
      copy.src = loader.src
      document.body.appendChild(copy)
    }
    if (shell !== null) {
      await import(`${shell.src}#again`)
    }
  })
  await page.waitForTimeout(500)
  await expect(page.locator(ISLAND)).toHaveCount(1)
  await expect(page.locator('#mu-overlay-root')).toHaveCount(1)

  // One click, one menu: the handlers were not duplicated.
  await page.locator(`${ISLAND} .mu-system-menu__trigger`).click()
  await expect(page.locator('#mu-overlay-root .mu-menu')).toHaveCount(1)
  await page.keyboard.press('Escape')
  expect(consoleMessages).toEqual([])
})

test('keyboard: every control reached by Tab shows a focus ring (v7 itself removes outlines)', async ({ page }) => {
  for (const url of [LIST, 'index.php?module=Accounts&view=Edit']) {
    await page.goto(url)
    await waitForShell(page)
    const missing: string[] = []
    let focused = 0
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press('Tab')
      // Rings fade in (0.15 s transition) unless reduced motion is asked for.
      await page.waitForTimeout(180)
      const result = await page.evaluate(() => {
        const element = document.activeElement
        if (element === null || element === document.body) {
          return null
        }
        const visible = (node: Element): boolean => {
          const style = getComputedStyle(node)
          return (style.boxShadow !== 'none' && !/^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(style.boxShadow))
            || (style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0)
        }
        // The ring may sit on the box around an input (search field of the header).
        const ring = visible(element) || [element.parentElement, element.parentElement?.parentElement].some((node) => node != null && node.matches(':focus-within') && visible(node))
        return { ring, name: `${element.tagName.toLowerCase()}${element.id === '' ? '' : `#${element.id}`}` }
      })
      if (result === null) {
        continue
      }
      focused++
      if (!result.ring) {
        missing.push(result.name)
      }
    }
    expect(focused, url).toBeGreaterThan(10)
    expect(missing, url).toEqual([])
  }
})

test('modals: quick create keeps Save and Cancel reachable, nothing is saved', async ({ page }) => {
  await page.goto(LIST)
  await waitForShell(page)
  await page.locator('#menubar_quickCreate').click()
  await page.locator('#menubar_quickCreate_Contacts').click()
  const form = page.locator('.modal-content form[name="QuickCreate"]')
  await expect(form).toBeVisible()
  await page.waitForTimeout(500)
  const footer = await form.evaluate((element) => {
    const save = element.querySelector('.modal-footer button[type="submit"], .modal-footer .btn-success')
    if (save === null) {
      return 'no save button'
    }
    const box = save.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && save.contains(hit) ? 'reachable' : `covered by ${hit?.className ?? 'nothing'}`
  })
  expect(footer).toBe('reachable')
  await form.locator('.modal-footer .cancelLink, .modal-footer [data-dismiss="modal"]').first().click()
  await expect(form).toBeHidden()
})

test('failures: without JavaScript the skin and the tokens style a working v7 page, nothing waits', async ({ browser }) => {
  const context = await browser.newContext({ storageState: test.info().project.use.storageState as string, javaScriptEnabled: false })
  await isolateNetwork(context)
  const page = await context.newPage()
  await page.goto(LIST)
  const state = await page.evaluate(() => ({
    pending: document.documentElement.classList.contains('mu-pending'),
    rows: document.querySelectorAll('tr.listViewEntries').length,
    navbar: document.getElementById('navbar') !== null,
    font: getComputedStyle(document.body).fontFamily,
  }))
  expect(state.pending).toBe(false)
  expect(state.navbar).toBe(true)
  expect(state.rows).toBeGreaterThan(0)
  expect(state.font).toContain('Poppins')
  await expect(page.locator(SKIN)).toHaveCount(1)
  await expect(page.locator(TOKENS)).toHaveCount(1)
  await context.close()
})

test('failures: a missing skin or tokens stylesheet never blocks the page', async ({ page }) => {
  for (const [name, pattern, status] of [
    ['skin', '**/modules/ModernUI/resources/dist/assets/skin-*.css*', 404],
    ['tokens', '**/index.php?module=ModernUI&action=Tokens*', 500],
  ] as const) {
    await page.route(pattern, (route) => route.fulfill({ status, contentType: 'text/html', body: '<html><body>error</body></html>' }))
    await page.goto(LIST)
    await waitForShell(page)
    const state = await themeOnPage(page)
    expect(state.ready, name).toBe(true)
    expect(state.failed, name).toBeNull()
    await expect(page.locator(ISLAND), name).toHaveCount(1)
    // The shell sets the tokens of Bootstrap inline, so even without the tokens stylesheet they are right.
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--mu-row-height')), name).toBe('40px')
    // The navigation of the theme works and the favorites bar never covers the header (stage 06).
    const trigger = page.locator('[data-mu-trigger="mega-menu"]')
    expect(await trigger.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return hit !== null && element.contains(hit)
    }), name).toBe(true)
    await trigger.click()
    await expect(page.locator('[data-mu-panel="mega-menu"]'), name).toBeVisible()
    await page.keyboard.press('Escape')
    await page.unroute(pattern)
  }
})

test('network: the theme loads only from the CRM itself, no dev server, CDN or repository paths', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  for (const url of [HOME, 'index.php?module=Accounts&view=List', SETTINGS, PREFERENCES]) {
    await page.goto(url)
    await page.waitForLoadState('networkidle')
  }
  const own = new URL(page.url()).host
  const theme = requests.filter((url) => url.includes('modules/ModernUI/') || url.includes('module=ModernUI'))
  expect(theme.length).toBeGreaterThan(3)
  expect(theme.filter((url) => new URL(url).host !== own)).toEqual([])
  expect(requests.filter((url) => /localhost:|:5173|\/@vite|\/@fs\/|node_modules|\/frontend\/src\//.test(url))).toEqual([])
})
