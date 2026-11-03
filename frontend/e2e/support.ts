/**
 * Shared steps of the browser scenarios: sign-in, network isolation of the clean stand, the Module Manager
 * (import/update of a ZIP, enable/disable switch) and collection of page errors.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test'
import { crmUrl, isClean, type Credentials } from './env'

export const SETTINGS = 'index.php?module=ModernUI&parent=Settings&view=Index'
export const PREFERENCES = 'index.php?module=ModernUI&view=Preferences'
export const HOME = 'index.php?module=Home&view=DashBoard'
export const MODULE_MANAGER = 'index.php?module=ModuleManager&parent=Settings&view=List'
export const MODULE_IMPORT = 'index.php?module=ModuleManager&parent=Settings&view=ModuleImport&mode=importUserModuleStep1'

export const SKIN = 'link[rel="stylesheet"][href*="modules/ModernUI/resources/dist/assets/skin-"]'
export const LOADER = 'script[src*="modules/ModernUI/resources/loader.js"]'
export const TOKENS = 'link[rel="stylesheet"][href*="module=ModernUI&action=Tokens"]'
export const ISLAND = '#navbar > [data-mu-root="system-menu"]'

/**
 * The clean stand must not talk to the internet: requests of the browser to other hosts than the CRM are
 * aborted and listed (for example the vendor's statistics pixel of the installer).
 */
export async function isolateNetwork(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = []
  if (!isClean) {
    return blocked
  }
  const own = new URL(crmUrl()).host
  await context.route(
    (url) => url.host !== own && (url.protocol === 'http:' || url.protocol === 'https:'),
    async (route) => {
      blocked.push(route.request().url())
      await route.abort('blockedbyclient')
    },
  )
  return blocked
}

export async function signIn(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('index.php')
  await page.locator('#username').fill(credentials.user)
  await page.locator('#password').fill(credentials.password)
  await Promise.all([
    page.waitForURL((url) => !url.searchParams.has('error') && url.pathname.endsWith('/index.php'), { timeout: 60_000 }),
    page.locator('form:has(#username) button[type="submit"]').first().click(),
  ])
  await completeFirstLogin(page)
  await page.waitForSelector('#navbar', { timeout: 60_000 })
}

/**
 * The first sign-in into a fresh 8.4.0 asks the first administrator which features to use (SystemSetup) and every
 * user for currency, language, time zone and date format (UserSetup). The scenario keeps all features and the
 * values already selected (English, the base currency).
 */
async function completeFirstLogin(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  if ((await page.locator('form#SystemSetup').count()) > 0) {
    const selectAll = page.locator('input.selectAll')
    if ((await selectAll.count()) > 0 && !(await selectAll.isChecked())) {
      await selectAll.check()
    }
    await Promise.all([page.waitForURL(/UserSetup|DashBoard|index\.php/), page.locator('form#SystemSetup button.next').click()])
    await page.waitForLoadState('domcontentloaded')
  }
  const userSetup = page.locator('form[action*="UserSetupSave"]')
  if ((await userSetup.count()) > 0) {
    await userSetup.evaluate((form: HTMLFormElement) => {
      const preferred: Record<string, string> = { lang_name: 'en_us', time_zone: 'UTC', date_format: 'yyyy-mm-dd' }
      for (const select of Array.from(form.querySelectorAll('select'))) {
        const wanted = preferred[select.name]
        if (wanted !== undefined && Array.from(select.options).some((option) => option.value === wanted)) {
          select.value = wanted
        } else if (select.value === '') {
          const first = Array.from(select.options).find((option) => option.value !== '')
          if (first !== undefined) {
            select.value = first.value
          }
        }
      }
    })
    await Promise.all([page.waitForURL((url) => !url.search.includes('UserSetup')), userSetup.locator('button[type="submit"]').click()])
  }
}

/** Uncaught page errors and console errors of a page, for comparisons with the theme switched off. */
export function watchErrors(page: Page): { console: string[]; page: string[] } {
  const errors = { console: [] as string[], page: [] as string[] }
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.console.push(message.text().slice(0, 300))
    }
  })
  page.on('pageerror', (error) => {
    errors.page.push(error.message.slice(0, 300))
  })
  return errors
}

export interface ThemeState {
  skin: number
  tokens: number
  loader: number
  ready: boolean
  failed: string | null
}

export async function themeOnPage(page: Page): Promise<ThemeState> {
  return {
    skin: await page.locator(SKIN).count(),
    tokens: await page.locator(TOKENS).count(),
    loader: await page.locator(LOADER).count(),
    ready: await page.evaluate(() => document.documentElement.classList.contains('mu-shell-ready')),
    failed: await page.evaluate(() => document.documentElement.getAttribute('data-mu-failed')),
  }
}

/** Until the shell is ready, failed, or settled on a page it only skins (data-mu-level="skin"). */
export async function waitForShell(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const html = document.documentElement
    return html.classList.contains('mu-shell-ready') || html.hasAttribute('data-mu-failed') || html.getAttribute('data-mu-level') === 'skin'
  })
}

/**
 * Settings → Module Manager → Import Module, as an administrator does it: upload, accept the disclaimer and
 * the license, "Import Now" for a new module or "Update Now" for a registered one.
 * @returns 'import' or 'update' — what the Module Manager offered
 */
export async function importModuleZip(page: Page, zipPath: string): Promise<'import' | 'update'> {
  await page.goto(MODULE_IMPORT)
  const form = page.locator('#importUserModule')
  // The form itself has no height (floated columns): wait for its checkbox.
  await expect(form.locator('input[name="acceptDisclaimer"]')).toBeVisible()
  await form.locator('input[name="acceptDisclaimer"]').check()
  await form.locator('input[name="moduleZip"]').setInputFiles(zipPath)
  // A multipart POST to index.php: the step is in the body, not in the URL.
  await Promise.all([page.waitForURL(/\/index\.php$/), form.locator('button[name="importFromZip"]').click()])
  const step2 = page.locator('#importModules')
  await expect(step2.locator('button.importModule, button.updateModule, .alert-danger, .alert-error').first()).toBeAttached()
  const refusal = step2.locator('.alert-danger, .alert-error')
  if ((await step2.locator('button.importModule, button.updateModule').count()) === 0) {
    throw new Error(`Module Manager refused the ZIP: ${(await refusal.allInnerTexts()).join(' ').trim()}`)
  }
  const license = step2.locator('input.acceptLicense')
  if ((await license.count()) > 0) {
    await license.check()
  }
  const update = step2.locator('button.updateModule')
  const kind = (await update.count()) > 0 ? 'update' : 'import'
  const button = kind === 'update' ? update : step2.locator('button.importModule')
  const result = page.waitForResponse(
    (response) => response.url().includes('index.php') && response.request().method() === 'POST'
      && /mode=(import|update)UserModuleStep3/.test(response.request().postData() ?? ''),
    { timeout: 300_000 },
  )
  await button.click()
  const response = await result
  expect(response.status()).toBe(200)
  const text = await response.text()
  let body: { success?: boolean } = {}
  try {
    body = JSON.parse(text) as { success?: boolean }
  } catch {
    throw new Error(`Module Manager ${kind}: not a JSON answer: ${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400)}`)
  }
  expect(body.success, `module manager ${kind}`).toBe(true)
  return kind
}

/** The enable/disable switch of a module in Settings → Module Manager (Settings_ModuleManager_Basic_Action). */
export async function setModuleActive(page: Page, module: string, active: boolean): Promise<void> {
  await page.goto(MODULE_MANAGER)
  const toggle = page.locator(`input[name="moduleStatus"][data-module="${module}"]`)
  await expect(toggle).toHaveCount(1)
  if ((await toggle.isChecked()) === active) {
    return
  }
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'POST' && (response.request().postData() ?? '').includes('mode=updateModuleStatus'),
  )
  await toggle.click()
  expect((await saved).status()).toBe(200)
}
