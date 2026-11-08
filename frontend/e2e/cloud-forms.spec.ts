/** Stage 14: real native forms, validation, failure recovery and navigation over the unchanged list. */
import { expect, test, type Page } from '@playwright/test'
import { cleanUserCredentials, crmUrl, isClean } from './env'
import { bootstrap, clearPersonal, globalScope, patchGlobal, savePersonal } from './settings-api'
import { deleteSynthetic, fillMandatory, formData, formState, isSave, payload, settle } from './records-support'
import { openCloudRecord } from './cloud-records-support'
import { isolateNetwork, signIn, waitForShell, watchErrors } from './support'

test.describe.configure({ mode: 'serial' })
const NAME = `MU14-${Date.now().toString(36)}`
const records: { module: string; id: string }[] = []
let personal: Record<string, unknown> = {}
let layout: unknown
let mode: unknown
let account = ''
const search = `&search_params=${encodeURIComponent(JSON.stringify([[['accountname', 'c', NAME]]]))}&page=1`
const form = (page: Page) => page.locator('#overlayPageContent form#EditView')

test.beforeEach(async ({ context, page }) => {
  await isolateNetwork(context)
  page.on('response', (response) => {
    const location = response.headers()['location']
    if (response.request().method() !== 'POST' || !location) return
    const data = new Map(payload(response.request()))
    if (data.get('action') !== 'Save' || data.get('record')) return
    const id = new URL(location, page.url()).searchParams.get('record') ?? ''
    if (/^\d+$/.test(id) && !records.some((record) => record.id === id)) records.push({ module: data.get('module') ?? '', id })
  })
})
test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto('index.php?module=Accounts&view=List&modernui=on')
  const global = await globalScope(page)
  layout = global.values['layout.modules']; mode = global.values['theme.mode']
  personal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  await patchGlobal(page, { 'layout.modules': [], ...(isClean ? { 'theme.mode': 'all' } : {}) })
  await page.close()
})
test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  try {
    for (const record of [...records].reverse()) await deleteSynthetic(page, record.module, record.id, 'MU14')
  } finally {
    await page.goto('index.php?module=Accounts&view=List&modernui=on')
    await patchGlobal(page, { 'layout.modules': layout ?? null, 'theme.mode': mode ?? null })
    await clearPersonal(page)
    if (Object.keys(personal).length) expect((await savePersonal(page, personal)).ok).toBe(true)
    await page.close()
  }
})

async function create(page: Page, module = 'Accounts'): Promise<void> {
  await page.goto(`index.php?module=${module}&view=List&modernui=on${module === 'Accounts' ? search : ''}`)
  await waitForShell(page)
  await page.locator(`[id="${module}_listView_basicAction_LBL_ADD_RECORD"]`).click()
  await expect(page.locator('html')).toHaveAttribute('data-mu-record', 'new')
  await expect(form(page)).toBeVisible()
  await settle(page)
}

async function edit(page: Page): Promise<void> {
  await openCloudRecord(page, 'Accounts', account, search)
  await page.locator('.mu-record-actions-toggle').click()
  await page.locator('#overlayPageContent [id$="_LBL_EDIT"]').click()
  await expect(form(page)).toBeVisible()
  await settle(page)
}

test('create: search cannot bypass validation, native fields survive, one pending submit and persisted result', async ({ page }) => {
  const errors = watchErrors(page)
  await create(page)
  const url = page.url()
  const nativeData = await formData(page)
  const hidden = await form(page).locator('td.fieldValue:not(:visible) [name]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))
  const searchField = page.locator('.mu-form-search input')
  await searchField.fill('MU14 no matching label')
  await expect(page.locator('.mu-form-empty')).toBeVisible()
  await searchField.fill('a') // A second query must search all native visible fields again.
  await searchField.fill('MU14 no matching label')
  let saves = 0
  page.on('request', (request) => { if (isSave('Accounts')(request)) saves++ })
  await form(page).locator('.saveButton').click()
  await expect(searchField).toHaveValue('')
  await expect(form(page).locator('.mu-form-error').first()).toBeVisible()
  await expect(form(page).locator('[name="accountname"]')).toBeInViewport()
  expect(saves).toBe(0)
  expect(await formData(page)).toEqual(nativeData)
  expect(await form(page).locator('td.fieldValue:not(:visible) [name]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('name')))).toEqual(hidden)
  expect(await fillMandatory(page, 'on')).toEqual([])
  await form(page).locator('[name="accountname"]').fill(`${NAME} Account Ä`)
  const expected = await formData(page)
  const route = '**/index.php'
  let release = (): void => { /* Assigned by the pending request gate below. */ }
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route(route, async (request) => {
    if (isSave('Accounts')(request.request())) await pending
    await request.continue()
  })
  const sent = page.waitForRequest(isSave('Accounts'))
  const clicked = form(page).locator('.saveButton').evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  try {
    await sent
    // A cancelled native navigation leaves Playwright's locator navigation barrier pending until the XHR ends.
    // Read the actual document while the Save transport is held, then exercise the native cancel handler.
    expect(await page.evaluate(() => {
      const form = document.querySelector('#overlayPageContent form#EditView')
      const pending = form?.getAttribute('aria-busy') === 'true' && form.querySelector<HTMLButtonElement>('.saveButton')?.disabled === true
      form?.querySelector<HTMLElement>('.cancelLink')?.click()
      return pending && form.isConnected
    })).toBe(true)
  } finally { release() }
  await clicked
  // Navigation API cancels the native submit. Chromium/Playwright may retain it in the locator navigation barrier;
  // observe the live document directly, as in the stage 09 overlay save scenario.
  await page.waitForFunction(() => document.querySelector('#overlayPageContent .mu-cloud-record')?.getClientRects().length
    && /^\d+$/.test(document.documentElement.getAttribute('data-mu-record') ?? ''))
  account = await page.evaluate(() => document.documentElement.getAttribute('data-mu-record') ?? '')
  expect(account).toMatch(/^\d+$/)
  if (!records.some((record) => record.id === account)) records.push({ module: 'Accounts', id: account })
  expect(saves).toBe(1)
  const actual = payload(await sent).filter(([name]) => name !== '__vtrftk')
  expect(actual).toEqual(expected.filter(([name]) => name !== '__vtrftk'))
  expect(page.url()).toBe(url)
  await page.unroute(route)
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.mu-record-back')?.click())
  await page.waitForFunction(() => !document.documentElement.hasAttribute('data-mu-record'))
  await page.goto(`index.php?module=Accounts&view=Edit&record=${account}&modernui=off`)
  await expect(page.locator('form#EditView [name="accountname"]')).toHaveValue(`${NAME} Account Ä`)
  expect(errors.page).toEqual([])
})

test('edit: HTTP failure retains values, retry saves once, cancel and Back ask before discarding changes', async ({ page }) => {
  await edit(page)
  await form(page).locator('[name="accountname"]').fill(`${NAME} Retried`)
  await page.route('**/index.php', async (route) => {
    if (isSave('Accounts')(route.request())) await route.fulfill({ status: 500, body: 'Synthetic failure' })
    else await route.continue()
  })
  const rejected = page.waitForResponse((response) => isSave('Accounts')(response.request()))
  await form(page).locator('.saveButton').evaluate((button: HTMLButtonElement) => { button.click() })
  expect((await rejected).status()).toBe(500)
  await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('#overlayPageContent .saveButton')?.disabled === false)
  expect(await page.evaluate(() => document.querySelector<HTMLInputElement>('#overlayPageContent [name="accountname"]')?.value)).toBe(`${NAME} Retried`)
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-notify=container], .vt-notification')).some((notice) => notice.getClientRects().length > 0 && notice.textContent.trim().length > 0))
  await page.unroute('**/index.php')
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#overlayPageContent .saveButton')?.click())
  await page.waitForFunction(() => document.querySelector('#overlayPageContent .mu-cloud-record')?.getClientRects().length)
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-mu-record'))).toBe(account)
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('.mu-record-back')?.click())
  await edit(page)
  await form(page).locator('[name="accountname"]').fill(`${NAME} Discarded`)
  await page.evaluate(() => { history.back() })
  await expect(page.locator('.bootbox')).toBeVisible()
  await page.locator('.bootbox [data-bb-handler="cancel"]').click()
  await expect(page.locator('.bootbox')).toHaveCount(0)
  await expect(form(page).locator('[name="accountname"]')).toHaveValue(`${NAME} Discarded`)
  await form(page).locator('.cancelLink').click()
  await page.locator('.bootbox [data-bb-handler="confirm"]').click()
  await expect(form(page)).toBeHidden()
  await page.goto(`index.php?module=Accounts&view=Edit&record=${account}&modernui=off`)
  await expect(page.locator('form#EditView [name="accountname"]')).toHaveValue(`${NAME} Retried`)
})

test('duplicate: native create permission and empty record produce another record; module redirect is honoured', async ({ page }) => {
  await openCloudRecord(page, 'Accounts', account, search)
  await page.locator('.mu-record-actions-toggle').click()
  await page.locator('#overlayPageContent .detailview-header [data-toggle="dropdown"]').click()
  await page.locator('#overlayPageContent a[href*="isDuplicate=true"]').click()
  await expect(form(page)).toBeVisible()
  await expect(form(page).locator('[name="record"]')).toHaveValue('')
  await form(page).locator('[name="accountname"]').fill(`${NAME} Duplicate`)
  // Preserve a native module's special return route, instead of replacing it by the ordinary record overlay.
  await page.route('**/index.php', async (route) => {
    if (!isSave('Accounts')(route.request())) { await route.continue(); return }
    const response = await route.fetch({ maxRedirects: 0 })
    const location = response.headers()['location']
    expect(location).toBeTruthy()
    const destination = new URL(location ?? '', page.url())
    const id = destination.searchParams.get('record') ?? ''
    expect(id).toMatch(/^\d+$/)
    if (!records.some((record) => record.id === id)) records.push({ module: 'Accounts', id })
    destination.searchParams.set('mode', 'showDetailViewByMode')
    destination.searchParams.set('requestMode', 'full')
    await route.fulfill({ response, headers: { ...response.headers(), location: destination.href } })
  })
  await form(page).locator('.saveButton').evaluate((button: HTMLButtonElement) => { button.click() })
  await page.waitForURL(/requestMode=full/)
  expect(new URL(page.url()).searchParams.get('record')).not.toBe(account)
  await expect(page.locator('.recordLabel').first()).toContainText(`${NAME} Duplicate`)
})

test('RU/EN/DE, four widths and 200%: sections, fields and footer remain reachable by keyboard', async ({ page }) => {
  test.setTimeout(240_000)
  for (const locale of ['ru-RU', 'en-US', 'de-DE']) {
    await page.goto('index.php?module=Accounts&view=List&modernui=on')
    expect((await savePersonal(page, { locale })).ok).toBe(true)
    for (const width of [1440, 1024, 768, 412]) {
      await page.setViewportSize({ width, height: 1000 })
      await create(page)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
      await expect(form(page).locator('.saveButton')).toBeInViewport()
      await page.locator('.mu-form-sections button').last().click()
      await expect(page.locator('.mu-form-sections button').last()).toHaveClass(/active/)
      await page.locator('.mu-form-search input').focus()
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => document.getElementById('overlayPageContent')?.contains(document.activeElement))).toBe(true)
      await form(page).locator('.cancelLink').click()
      await expect(form(page)).toBeHidden()
    }
  }
  await page.setViewportSize({ width: 720, height: 500 })
  await create(page)
  await expect(form(page).locator('.saveButton')).toBeInViewport()
  await page.locator('.mu-form-search input').fill('MU14')
  await page.keyboard.press('Escape')
  await expect(page.locator('.mu-form-search input')).toHaveValue('')
  await expect(form(page)).toBeVisible()
  await form(page).locator('.cancelLink').click()
})

test('custom module: create, reopen, edit and delete through native forms', async ({ page }) => {
  const modules = isClean ? ['Gadgets'] : (process.env['MU_E2E_FORM_MODULES'] ?? '').split(',').filter(Boolean)
  expect(modules.length, 'custom module fixture is configured').toBeGreaterThan(0)
  for (const module of modules) {
    await create(page, module)
    expect(await fillMandatory(page, 'on')).toEqual([])
    const title = form(page).locator('td.fieldValue input[type="text"][data-rule-required="true"]').first()
    const name = await title.getAttribute('name') ?? ''
    await title.fill(`${NAME} Custom`)
    await form(page).locator('.saveButton').evaluate((button: HTMLButtonElement) => { button.click() })
    await page.waitForFunction(() => document.querySelector('#overlayPageContent .mu-cloud-record')?.getClientRects().length)
    const id = await page.evaluate(() => document.documentElement.getAttribute('data-mu-record') ?? '')
    expect(id).toMatch(/^\d+$/)
    if (!records.some((record) => record.id === id)) records.push({ module, id })
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('.mu-record-back')?.click())
    await page.waitForFunction(() => !document.documentElement.hasAttribute('data-mu-record'))
    await page.goto(`index.php?module=${module}&view=Edit&record=${id}&modernui=off`)
    await expect(page).toHaveURL(/modernui=off/)
    await expect(page.locator(`form#EditView [name="${name}"]`)).toHaveValue(`${NAME} Custom`)
    await settle(page)
    const editable = page.locator('form#EditView td.fieldValue input.inputElement[type="text"]:visible:not([readonly]):not(.autoComplete)').first()
    const editName = await editable.getAttribute('name') ?? ''
    expect(editName).not.toBe('')
    const fieldType = await editable.evaluate((element: HTMLInputElement) => {
      const meta = (window as unknown as { uimeta?: { field: { getType: (name: string) => string } } }).uimeta
      return `${element.getAttribute('data-fieldtype') ?? ''} ${meta?.field.getType(element.name) ?? ''}`
    })
    const changed = /double|integer|currency|number/.test(fieldType) ? '19' : `${NAME} Edited`
    await page.goto(`index.php?module=${module}&view=Edit&record=${id}&modernui=on`)
    await settle(page)
    await page.locator(`form#EditView [name="${editName}"]`).fill(changed)
    const saved = page.waitForResponse((response) => isSave(module)(response.request()))
    await page.locator('form#EditView .saveButton').click()
    const response = await saved
    expect(response.status()).toBe(302)
    const destination = new URL(response.headers()['location'] ?? '', page.url())
    await page.waitForURL(destination.href)
    await page.goto(`index.php?module=${module}&view=Edit&record=${id}&modernui=off`)
    await expect(page.locator(`form#EditView [name="${editName}"]`)).toHaveValue(changed)
  }
})


test('quick create: native SaveAjax, persisted value, validation and narrow dialog actions', async ({ page }) => {
  for (const mode of ['off', 'on']) {
    await page.goto(`index.php?module=Accounts&view=List&modernui=${mode}`)
    if (mode === 'on') await waitForShell(page)
    await page.locator('#menubar_quickCreate').click()
    await page.locator('#menubar_quickCreate_Accounts').click()
    const quick = page.locator('form[name="QuickCreate"]')
    await expect(quick).toBeVisible()
    await settle(page)
    await quick.locator('button[type="submit"]').click()
    await expect(quick.locator('.input-error').first()).toBeVisible()
    expect(await fillMandatory(page, 'on', 'form[name="QuickCreate"]')).toEqual([])
    const name = `${NAME} Quick ${mode}`
    await quick.locator('[name="accountname"]').fill(name)
    if (mode === 'on') {
      await page.setViewportSize({ width: 412, height: 800 })
      await expect(quick.locator('button[type="submit"]')).toBeInViewport()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    }
    const saved = page.waitForResponse((response) => response.request().method() === 'POST'
      && payload(response.request()).some(([key, value]) => key === 'action' && value === 'SaveAjax'))
    await quick.locator('button[type="submit"]').click()
    const answer = await (await saved).json() as { success?: boolean; result?: { _recordId?: string | number } }
    expect(answer.success).toBe(true)
    const id = String(answer.result?._recordId ?? '')
    expect(id).toMatch(/^\d+$/)
    records.push({ module: 'Accounts', id })
    await expect(quick).toBeHidden()
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`index.php?module=Accounts&view=Edit&record=${id}&modernui=off`)
    await expect(page.locator('form#EditView [name="accountname"]')).toHaveValue(name)
  }
})

test('inventory sections scroll inside the body and preserve the pinned heading and footer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await create(page, 'SalesOrder')
  const header = page.locator('#overlayPageContent .overlayHeader')
  const footer = page.locator('#overlayPageContent .overlayFooter')
  const before = [await header.boundingBox(), await footer.boundingBox()]
  const last = page.locator('.mu-form-sections button').last()
  await Promise.all([
    form(page).locator('.editViewContents').evaluate((node) => new Promise<void>((resolve) => {
      node.addEventListener('scrollend', () => { resolve() }, { once: true })
    })),
    last.click(),
  ])
  await expect(last).toHaveAttribute('aria-current', 'location')
  const after = [await header.boundingBox(), await footer.boundingBox()]
  for (const index of [0, 1]) expect(after[index]?.y).toBe(before[index]?.y)
  await expect(form(page).locator('.saveButton')).toBeInViewport()
  await form(page).locator('.cancelLink').click()
})

test('restricted user: native field rights, inaccessible edit and duplicate cannot be bypassed by the form view', async ({ browser }) => {
  test.skip(!isClean, 'isolated restricted users exist on the clean stand')
  for (const user of ['limited', 'viewer'] as const) {
    const context = await browser.newContext({ baseURL: crmUrl(), storageState: { cookies: [], origins: [] } })
    await isolateNetwork(context)
    const page = await context.newPage()
    try {
      await signIn(page, cleanUserCredentials(user))
      for (const query of [`record=${account}`, `record=${account}&isDuplicate=true`]) {
        const native = await page.request.get(`index.php?module=Accounts&view=Edit&${query}`)
        const composed = await page.request.get(`index.php?module=ModernUI&view=Form&formModule=Accounts&${query}`)
        const nativeBody = await native.text()
        const composedBody = await composed.text()
        const [nativeState, composedState] = await page.evaluate((bodies) => bodies.map((body) => {
          const document = new DOMParser().parseFromString(body, 'text/html')
          // The native full page stores "Permission denied" in its hidden translation dictionary.
          document.querySelectorAll('script, style, #js_strings').forEach((node) => { node.remove() })
          return {
            hasForm: !!document.querySelector('form#EditView'),
            denied: /Permission denied|Доступ запрещ|Zugriff verweigert|not permitted/i.test(document.body.textContent),
          }
        }), [nativeBody, composedBody])
        expect(composedState).toEqual(nativeState)
        if (!query.includes('isDuplicate')) expect(composedState?.denied).toBe(true)
      }
      if (user === 'limited') {
        await page.goto('index.php?module=Accounts&view=List&modernui=on')
        const own = await page.locator('tr.listViewEntries', { hasText: 'Müller & Söhne GmbH' }).first().getAttribute('data-id') ?? ''
        expect(own).toMatch(/^\d+$/)
        await page.goto(`index.php?module=Accounts&view=Edit&record=${own}&modernui=off`)
        const baseline = await formState(page)
        await openCloudRecord(page, 'Accounts', own)
        await page.locator('.mu-record-actions-toggle').click()
        await page.locator('#overlayPageContent [id$="_LBL_EDIT"]').click()
        await expect(form(page)).toBeVisible()
        // Native full Edit includes an appName navigation hint; native overlay Edit omits that hidden control.
        expect(await formState(page, '#overlayPageContent form#EditView')).toEqual(baseline.filter((field) => field.name !== 'appName'))
        expect(baseline.some((field) => field.name === 'annual_revenue')).toBe(false)
      }
    } finally { await context.close() }
  }
})
