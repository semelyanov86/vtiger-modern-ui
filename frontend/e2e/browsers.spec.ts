/**
 * Stage 19 — the same core scenarios in Chromium, Firefox and WebKit (projects browsers-chromium, browsers-firefox,
 * browsers-webkit; the clean stand, docs/compatibility.md §11): the shell starts with the cloud header and fonts, the
 * mega menu by mouse and keyboard, a list without the module rail, a record over the list with Escape and Back/Forward,
 * the edit form in the window and its cancel, the settings page of ModernUI and the preferences, the safe mode, a
 * failing Bootstrap that leaves the standard interface, and no script error of the theme. Each project writes the
 * real browser version: .local/e2e-reports/<target>/browsers-<browser>.json. Read-only for the CRM.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { reportDir } from './env'
import { HOME, PREFERENCES, SETTINGS, themeOnPage, waitForShell } from './support'

test.describe.configure({ mode: 'serial' })

const LIST = 'index.php?module=Accounts&view=List'
const RECORD_LINK = '#listViewContent tr.listViewEntries[data-id] a[href*="view=Detail"]:not([href*="mode="])'
const TRIGGER = '[data-mu-trigger="mega-menu"]'
const PANEL = '[data-mu-panel="mega-menu"]'

/** The window finished opening: its content is there and the focus moved into it (Escape then closes it). */
async function recordOpen(page: Page): Promise<void> {
  await expect(page.locator('#overlayPageContent.in .overlayDetail td.fieldValue').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => document.getElementById('overlayPageContent')?.contains(document.activeElement) ?? false), { timeout: 30_000 }).toBe(true)
}

const ownErrors: string[] = []
const notes: Record<string, unknown> = {}

test.afterAll(({ browser, browserName }) => {
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(resolve(reportDir(), `browsers-${browserName}.json`), `${JSON.stringify({ browser: browserName, version: browser.version(), ownErrors, notes }, null, 2)}\n`)
})

test.beforeEach(({ page }) => {
  page.on('pageerror', (error) => {
    if (/ModernUI|modernui|mu-|\/dist\/assets\//.test(`${error.message} ${error.stack ?? ''}`)) {
      ownErrors.push(error.message.slice(0, 200))
    }
  })
})

test('shell: the cloud header, fonts and tokens; the mega menu by mouse and keyboard', async ({ page }) => {
  await page.goto(`${LIST}&modernui=on`)
  await waitForShell(page)
  const state = await themeOnPage(page)
  expect(state.ready).toBe(true)
  expect(state.failed).toBeNull()
  const header = await page.evaluate(() => {
    const nav = document.querySelector('#page > nav.app-fixed-navbar')?.getBoundingClientRect()
    const add = document.querySelector('[id$="_basicAction_LBL_ADD_RECORD"]')
    return {
      height: nav?.height ?? 0,
      font: getComputedStyle(document.body).fontFamily,
      primary: add === null ? '' : getComputedStyle(add).backgroundColor,
      rail: document.querySelector('#modnavigator') === null ? 0 : document.querySelector('#modnavigator')?.getBoundingClientRect().width ?? 0,
    }
  })
  notes['header'] = header
  expect(header.height).toBeGreaterThanOrEqual(90)
  expect(header.height).toBeLessThanOrEqual(110)
  expect(header.font).toMatch(/Poppins/)
  expect(header.primary).toBe('rgb(57, 120, 254)')
  expect(header.rail, 'no module rail on the list').toBe(0)
  // A face of Poppins was really downloaded from the CRM and used (the subsets load by unicode-range on demand).
  await expect.poll(() => page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].some((face) => face.family.replace(/["']/g, '') === 'Poppins' && face.status === 'loaded')
  })).toBe(true)

  await page.locator(TRIGGER).click()
  await expect(page.locator(PANEL)).toBeVisible()
  await page.locator(`${PANEL} [data-mu-field="menu-search"]`).fill('zzqqxx')
  // The empty result names the query (in any language of the theme).
  await expect(page.locator(PANEL)).toContainText('zzqqxx')
  await page.keyboard.press('Escape')
  await expect(page.locator(PANEL)).toBeHidden()
  await page.locator(TRIGGER).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(PANEL)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator(TRIGGER)).toBeFocused()
})

test('record over the list: open, Escape, Back/Forward; edit in the window and cancel', async ({ page }) => {
  await page.goto(LIST)
  await waitForShell(page)
  const url = page.url()
  await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
  await recordOpen(page)
  expect(page.url()).toBe(url)
  await page.keyboard.press('Escape')
  await expect(page.locator('html[data-mu-record]')).toHaveCount(0)
  await expect(page.locator('#overlayPageContent.in')).toHaveCount(0, { timeout: 30_000 })
  await page.locator(RECORD_LINK).filter({ visible: true }).first().click()
  await recordOpen(page)
  await page.goBack()
  await expect(page.locator('html[data-mu-record]')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.locator('#overlayPageContent.in')).toHaveCount(0, { timeout: 30_000 })
  await page.goForward()
  await expect(page.locator('html[data-mu-record]')).toHaveCount(1, { timeout: 30_000 })
  await recordOpen(page)
  const edit = page.locator('#overlayPageContent [id$="_detailView_basicAction_LBL_EDIT"]').first()
  if (!(await edit.isVisible())) {
    await page.locator('#overlayPageContent .mu-record-actions-toggle').first().click()
  }
  await edit.click()
  const form = page.locator('#overlayPageContent form#EditView')
  await expect(form).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.mu-form-sections, .mu-form-search').first()).toBeVisible()
  const save = form.locator('.saveButton').first()
  await expect(save).toBeVisible()
  const box = await save.boundingBox()
  expect(box !== null && box.width > 0 && box.y + box.height <= (page.viewportSize()?.height ?? 900), 'Save inside the window').toBe(true)
  await form.locator('.cancelLink').first().click()
  await expect(form).toHaveCount(0, { timeout: 30_000 })
  for (let attempt = 0; attempt < 3 && (await page.locator('html[data-mu-record]').count()) > 0; attempt++) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }
  await expect(page.locator('html[data-mu-record]')).toHaveCount(0)
  await expect(page.locator('#overlayPageContent.in')).toHaveCount(0, { timeout: 30_000 })
})

test('settings page of ModernUI and the preferences: the editor, its tabs and the server forms', async ({ page }) => {
  await page.goto(SETTINGS)
  await expect(page.locator('.mu-editor').first()).toBeVisible({ timeout: 30_000 })
  const tabs = page.locator('.mu-editor [role="tab"]')
  await expect(tabs.first()).toBeVisible({ timeout: 30_000 })
  expect(await tabs.count()).toBeGreaterThan(3)
  await tabs.nth(1).click()
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.goto(`${SETTINGS}&editor=off`)
  await expect(page.locator('table.modernui-status')).toBeVisible()
  await page.goto(PREFERENCES)
  await expect(page.locator('[data-mu-root], .modernui-preferences-form').first()).toBeVisible({ timeout: 30_000 })
})

test('safe mode and a failing Bootstrap leave the standard interface working', async ({ page }) => {
  await page.goto(`${HOME}&modernui=off`)
  expect((await themeOnPage(page)).skin).toBe(0)
  await page.goto(`${HOME}&modernui=on`)
  await waitForShell(page)
  await page.route((url) => url.searchParams.get('module') === 'ModernUI' && url.searchParams.get('action') === 'Bootstrap',
    (route) => route.fulfill({ status: 500, contentType: 'text/html', body: '<html><body>error</body></html>' }))
  await page.goto(LIST)
  await waitForShell(page)
  const state = await themeOnPage(page)
  expect(state.ready).toBe(false)
  expect(state.failed).not.toBeNull()
  await page.locator('#appnavigator').click()
  await expect(page.locator('#app-menu')).toBeVisible()
  await page.keyboard.press('Escape')
  const link = page.locator(RECORD_LINK).filter({ visible: true }).first()
  await expect(link).toBeVisible()
  const free = await link.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return hit !== null && element.contains(hit)
  })
  expect(free, 'the first record of the list is not covered').toBe(true)
  await page.unrouteAll()
  expect(ownErrors, 'script errors of the theme').toEqual([])
})
