/** Explicit template installation, native authentication and public branding. Settings and templates are restored. */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { adminCredentials, cleanUserCredentials, crmUrl, isClean, stateFile } from './env'
import { SETTINGS, SETTINGS_FORMS, HOME, isolateNetwork, setModuleActive, signIn, waitForShell } from './support'
import { globalScope, patchGlobal, pngFile, post, saveGlobal, type Scope } from './settings-api'

test.describe.configure({ mode: 'serial' })
let original: Scope | undefined
let installedBefore = false
const shots = process.env['MU_AUTH_SHOTS_DIR'] ?? ''

async function screenshot(page: Page, name: string): Promise<void> {
  if (shots !== '') {
    mkdirSync(shots, { recursive: true })
    await page.screenshot({ path: resolve(shots, `${name}.png`) })
  }
}

async function guest(browser: Browser, javaScriptEnabled = true): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, javaScriptEnabled, storageState: { cookies: [], origins: [] } })
  await isolateNetwork(context)
  return context
}

async function install(page: Page, enabled: boolean): Promise<void> {
  await page.goto(SETTINGS_FORMS)
  const button = page.locator(`[name="modernui-auth-${enabled ? 'install' : 'restore'}"]`)
  if (await button.isEnabled()) {
    await button.click()
    await expect(page).toHaveURL(new RegExp(`result=auth_${enabled ? 'installed' : 'restored'}`))
  }
  await expect(page.locator('[data-mu-auth-install]')).toHaveAttribute('data-mu-auth-install', enabled ? 'installed' : 'original')
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: crmUrl(), storageState: stateFile('admin') })
  const page = await context.newPage()
  try {
    await isolateNetwork(context)
    await page.goto(SETTINGS_FORMS)
    original = await globalScope(page)
    installedBefore = await page.locator('[data-mu-auth-install]').getAttribute('data-mu-auth-install') === 'installed'
    await install(page, true)
  } finally { await context.close() }
})

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: crmUrl(), storageState: stateFile('admin') })
  const page = await context.newPage()
  try {
    await isolateNetwork(context)
    await page.goto(SETTINGS_FORMS)
    if (original !== undefined) expect((await saveGlobal(page, original.values)).ok).toBe(true)
    if (original !== undefined) await install(page, installedBefore)
  } finally { await context.close() }
})

test('native login: required fields, invalid credentials and a fresh successful login', async ({ browser }) => {
  const context = await guest(browser)
  const page = await context.newPage()
  try {
    await page.goto('index.php?authlang=en-US')
    await expect(page.locator('[data-mu-auth="login"]')).toBeVisible()
    await expect(page.locator('.mu-auth__logo')).toBeVisible()
    expect(await page.locator('.mu-auth__logo').evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
    await page.locator('button[type="submit"]').click()
    expect(await page.locator('#username').evaluate((node: HTMLInputElement) => node.validity.valueMissing)).toBe(true)
    await page.locator('#username').fill('MU-AUTH-NOT-A-USER')
    await page.locator('#password').fill('MU-auth-invalid-password')
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL(/error=login/)
    await expect(page.locator('.mu-auth')).toHaveAttribute('lang', 'en-US')
    await expect(page.locator('.mu-auth__message[role="alert"]')).toBeVisible()
    await signIn(page, adminCredentials())
    await expect(page.locator('#navbar')).toBeVisible()
  } finally { await context.close() }
})

test('recovery: native payload and error remain visible; keyboard and no JavaScript', async ({ browser }) => {
  const context = await guest(browser, false)
  const page = await context.newPage()
  try {
    await page.goto('index.php?authlang=en-US')
    await page.getByRole('link', { name: 'Forgot Password?' }).click()
    await expect(page.locator('[data-mu-auth="recovery"]')).toBeVisible()
    await expect(page.locator('form')).toHaveAttribute('action', 'forgotPassword.php')
    await page.locator('#fusername').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('#email')).toBeFocused()
    await page.locator('#fusername').fill(adminCredentials().user)
    await page.locator('#email').fill('mu-auth-no-match@example.invalid')
    const request = page.waitForRequest((entry) => entry.url().endsWith('/forgotPassword.php') && entry.method() === 'POST')
    await page.locator('button[type="submit"]').click()
    const body = new URLSearchParams((await request).postData() ?? '')
    expect(body.get('username')).toBe(adminCredentials().user)
    expect(body.get('emailId')).toBe('mu-auth-no-match@example.invalid')
    await expect(page.locator('[data-mu-auth="recovery"] .mu-auth__message')).toBeVisible()
    await expect(page.locator('.mu-auth')).toHaveAttribute('lang', 'en-US')
    await expect(page.locator('#email')).toBeVisible()
    await page.locator('.mu-auth__links a').click()
    await expect(page.locator('[data-mu-auth="login"]')).toBeVisible()
    await signIn(page, adminCredentials())
  } finally { await context.close() }
})

test('notice is controlled by global settings on public pages and in the header', async ({ browser, page }) => {
  await page.goto(SETTINGS_FORMS)
  await patchGlobal(page, { 'branding.noticeEnabled': true, 'branding.notice': { 'en-US': 'MU AUTH internal', 'ru-RU': 'MU AUTH служебное', 'de-DE': 'MU AUTH intern' } })
  const context = await guest(browser)
  const publicPage = await context.newPage()
  try {
    for (const [locale, text] of [['en-US', 'MU AUTH internal'], ['ru-RU', 'MU AUTH служебное'], ['de-DE', 'MU AUTH intern']]) {
      await publicPage.goto(`index.php?authlang=${locale ?? ''}`)
      await expect(publicPage.locator('.mu-auth__notice')).toHaveText(text ?? '')
      await publicPage.locator('.mu-auth__links a').click()
      await expect(publicPage.locator('.mu-auth__notice')).toHaveText(text ?? '')
    }
    await page.goto(HOME)
    await waitForShell(page)
    await expect(page.locator('.mu-brand__notice')).toBeVisible()
    await page.setViewportSize({ width: 1024, height: 900 })
    await screenshot(page, 'header-notice-1024')
    await screenshot(publicPage, 'recovery-notice')
    await page.goto(SETTINGS_FORMS)
    await patchGlobal(page, { 'branding.noticeEnabled': false })
    await publicPage.reload()
    await expect(publicPage.locator('.mu-auth__notice')).toHaveCount(0)
    await page.goto(HOME)
    await waitForShell(page)
    await expect(page.locator('.mu-brand__notice')).toHaveCount(0)
  } finally { await context.close() }
})

test('public pages use the organisation logo, then the theme upload, then the organisation again', async ({ browser, page }) => {
  await page.goto(SETTINGS_FORMS)
  await patchGlobal(page, { 'branding.logo': 'company' })
  await page.goto(HOME)
  const companyLogo = await page.locator('nav.app-fixed-navbar .company-logo > img').getAttribute('src')
  const context = await guest(browser)
  const publicPage = await context.newPage()
  try {
    await publicPage.goto('index.php')
    await expect(publicPage.locator('.mu-auth__logo')).toHaveAttribute('src', companyLogo ?? '')
    await page.goto(`${SETTINGS}#mu-appearance`)
    await page.locator('[data-mu-logo="custom"]').check()
    await page.locator('[data-mu-field="logo-file"]').setInputFiles({ name: 'auth-logo.png', mimeType: 'image/png', buffer: await pngFile(600, 200, [10, 125, 79]) })
    await expect(page.locator('.mu-logo__preview')).toBeVisible()
    await page.locator('[data-mu-action="save"]').click()
    await expect(page.locator('[data-mu-status].mu-text-success')).toBeVisible()
    await publicPage.reload()
    await expect(publicPage.locator('.mu-auth__logo')).toHaveAttribute('src', /key=modernui_[0-9a-f]{40}\.png$/)
    await expect.poll(() => publicPage.locator('.mu-auth__logo').evaluate((node: HTMLImageElement) => node.naturalWidth)).toBe(600)
    await publicPage.locator('.mu-auth__links a').click()
    await expect(publicPage.locator('.mu-auth__logo')).toHaveAttribute('src', /key=modernui_/)
    await page.goto(SETTINGS_FORMS)
    await patchGlobal(page, { 'branding.logo': 'company' })
    await publicPage.reload()
    await expect(publicPage.locator('.mu-auth__logo')).toHaveAttribute('src', companyLogo ?? '')
  } finally { await context.close() }
})

test('clean mail trap: reset link, confirmation validation and successful native password reset', async ({ browser, request }) => {
  const mailUrl = process.env['MU_AUTH_MAIL_URL'] ?? ''
  test.skip(!isClean || mailUrl === '', 'only synthetic users and the isolated mail trap')
  const credentials = cleanUserCredentials('limited')
  const list = async (): Promise<{ ID: string; To: { Address: string }[] }[]> => {
    const response = await request.get(`${mailUrl}/api/v1/messages`)
    expect(response.ok()).toBe(true)
    const data = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] }
    return data.messages
  }
  const before = new Set((await list()).map((message) => message.ID))
  const context = await guest(browser)
  const page = await context.newPage()
  let mailId = ''
  try {
    await page.goto('index.php?screen=recovery&authlang=en-US')
    await page.locator('#fusername').fill(credentials.user)
    await page.locator('#email').fill(`${credentials.user}@clean.example.test`)
    await page.locator('button[type="submit"]').click()
    await expect(page.locator('.mu-auth__message--success')).toBeVisible()
    await expect.poll(async () => {
      const message = (await list()).find((item) => !before.has(item.ID) && item.To.some((recipient) => recipient.Address === `${credentials.user}@clean.example.test`))
      mailId = message?.ID ?? ''
      return mailId !== ''
    }).toBe(true)
    const response = await request.get(`${mailUrl}/api/v1/message/${mailId}`)
    const mail = await response.json() as { HTML: string }
    const link = /href=["']?([^"'\s>]*shorturl\.php\?id=[^"'\s>]+)/i.exec(mail.HTML)?.[1]
    expect(link !== undefined).toBe(true)
    expect(new URL(link ?? '', crmUrl()).origin).toBe(new URL(crmUrl()).origin)
    await page.goto(link ?? '')
    await expect(page.locator('[data-mu-auth="change"]')).toBeVisible()
    await expect(page.locator('.mu-auth__input').first()).toHaveCSS('height', '38px')
    await expect.poll(() => page.locator('.mu-auth__logo').evaluate((node: HTMLImageElement) => node.naturalWidth > 0)).toBe(true)
    await page.locator('#password').fill(credentials.password)
    await page.locator('#confirmPassword').fill('MU-auth-mismatch')
    await page.locator('button[type="submit"]').click()
    expect(await page.locator('#confirmPassword').evaluate((node: HTMLInputElement) => node.validity.customError)).toBe(true)
    await page.locator('#confirmPassword').fill(credentials.password)
    await screenshot(page, 'change-password')
    await page.locator('button[type="submit"]').click()
    // Resetting to the same generated password verifies the native flow and preserves the fixture credentials.
    await expect(page.locator('#navbar')).toBeVisible({ timeout: 30_000 })
    const fresh = await guest(browser)
    try { await signIn(await fresh.newPage(), credentials) } finally { await fresh.close() }
  } finally {
    await context.close()
    if (mailId !== '') await request.delete(`${mailUrl}/api/v1/messages`, { data: { IDs: [mailId] } })
  }
})

test('RU EN DE, cloud geometry, mobile and 200 percent layout', async ({ browser }) => {
  const context = await guest(browser)
  const page = await context.newPage()
  try {
    for (const locale of ['en-US', 'ru-RU', 'de-DE']) {
      for (const width of [1440, 1024, 768, 412, 360]) {
        await page.setViewportSize({ width, height: width === 360 ? 450 : 900 })
        await page.goto(`index.php?authlang=${locale}`)
        await expect(page.locator('.mu-auth')).toHaveAttribute('lang', locale)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const field = await page.locator('#username').boundingBox()
        expect(field?.height).toBe(38)
        expect(field?.width).toBe(300)
        expect(field?.y).toBe(140)
        const button = await page.locator('.mu-auth__button').boundingBox()
        expect(button?.y).toBe(248)
        if (width === 1440 || width === 412 || width === 360) await screenshot(page, `login-${locale}-${String(width)}`)
        await page.locator('.mu-auth__links a').click()
        await expect(page.locator('[data-mu-auth="recovery"]')).toBeVisible()
        await expect(page.locator('.mu-auth__title')).toHaveCSS('font-weight', '500')
        await expect(page.locator('.mu-auth__button')).toHaveCSS('background-color', 'rgb(19, 204, 115)')
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const recovery = await page.locator('#fusername').boundingBox()
        expect(recovery?.width).toBe(width >= 768 ? 510 : width - 40)
        if (width === 1440 || width === 412 || width === 360) await screenshot(page, `recovery-${locale}-${String(width)}`)
      }
    }
  } finally { await context.close() }
})

test('settings expose notice fields, install and restore; safe mode retains native pages', async ({ browser, page }) => {
  await page.goto(`${SETTINGS}#mu-appearance`)
  await expect(page.locator('[data-mu-field="notice-enabled"]')).toBeVisible()
  await page.locator('[data-mu-tab="maintenance"]').click()
  await expect(page.locator('[name="modernui-auth-restore"]')).toBeVisible()
  const context = await guest(browser)
  const publicPage = await context.newPage()
  try {
    await publicPage.goto('index.php?modernui=off')
    await expect(publicPage.locator('[data-mu-auth]')).toHaveCount(0)
    await expect(publicPage.locator('#username')).toBeVisible()
    await publicPage.goto('index.php?modernui=on')
    await expect(publicPage.locator('[data-mu-auth="login"]')).toBeVisible()
    await install(page, false)
    await publicPage.reload()
    await expect(publicPage.locator('[data-mu-auth]')).toHaveCount(0)
    await expect(publicPage.locator('#username')).toBeVisible()
    await install(page, true)
    await publicPage.reload()
    await expect(publicPage.locator('[data-mu-auth="login"]')).toBeVisible()
    if (isClean) {
      try {
        await setModuleActive(page, 'ModernUI', false)
        await publicPage.reload()
        await expect(publicPage.locator('[data-mu-auth]')).toHaveCount(0)
        await expect(publicPage.locator('#username')).toBeVisible()
      } finally { await setModuleActive(page, 'ModernUI', true) }
      await publicPage.reload()
      await expect(publicPage.locator('[data-mu-auth="login"]')).toBeVisible()
    }
  } finally { await context.close() }
})

test('installation rejects missing CSRF and non-administrators', async ({ browser, page }) => {
  await page.goto(SETTINGS_FORMS)
  expect((await post(page, { module: 'ModernUI', parent: 'Settings', action: 'AuthPages', mode: 'restore' }, false)).ok).toBe(false)
  await page.reload()
  await expect(page.locator('[data-mu-auth-install]')).toHaveAttribute('data-mu-auth-install', 'installed')
  if (isClean) {
    const context = await guest(browser)
    const restricted = await context.newPage()
    try {
      await signIn(restricted, cleanUserCredentials('limited'))
      const result = await post(restricted, { module: 'ModernUI', parent: 'Settings', action: 'AuthPages', mode: 'restore' })
      expect(result.ok).toBe(false)
      await page.reload()
      await expect(page.locator('[data-mu-auth-install]')).toHaveAttribute('data-mu-auth-install', 'installed')
    } finally { await context.close() }
  }
})
