/** Stage 13: native Detail contracts in the cloud window, real inline/related writes, navigation and failure boundaries. */
import { expect, test, type Page } from '@playwright/test'
import { cleanUserCredentials, crmUrl, isClean } from './env'
import { bootstrap, clearPersonal, globalScope, patchGlobal, savePersonal } from './settings-api'
import { deleteSynthetic, fillMandatory, payload, pickInPopup, settle, token } from './records-support'
import { isolateNetwork, signIn, waitForShell, watchErrors } from './support'
import { openCloudRecord, recordContract, recordTab } from './cloud-records-support'

const NAME = `MU13-${Date.now().toString(36)} Ä Organisation`
const search = `&search_params=${encodeURIComponent(JSON.stringify([[['accountname', 'c', NAME]]]))}&page=1`
const route = /module=ModernUI&view=Record/
let id = ''
let oldLayout: unknown
let oldMode: unknown
let personal: Record<string, unknown> = {}
const created: { module: string; id: string }[] = []

async function fixture(page: Page, module: string, fields: Record<string, string>): Promise<string> {
  const response = await page.request.post('index.php', {
    form: { module, action: 'SaveAjax', assigned_user_id: '1', ...fields, __vtrftk: await token(page) },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })
  const result = await response.json() as { success: boolean; result: { _recordId: number } }
  expect(result.success).toBe(true)
  const record = String(result.result._recordId)
  created.push({ module, id: record })
  return record
}

test.use({ actionTimeout: 15_000 })
test.beforeEach(async ({ context, page }) => {
  await isolateNetwork(context)
  page.on('console', (message) => {
    if (message.text().startsWith('[ModernUI]')) console.log(message.text())
  })
  page.on('pageerror', (error) => { console.log(`record pageerror: ${error.message}`) })
})

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage()
  await page.goto('index.php?module=Accounts&view=List&modernui=on')
  const global = await globalScope(page)
  oldLayout = global.values['layout.modules']; oldMode = global.values['theme.mode']
  personal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  await patchGlobal(page, { 'layout.modules': [], ...(isClean ? { 'theme.mode': 'all' } : {}) })
  const response = await page.request.post('index.php', {
    form: { module: 'Accounts', action: 'SaveAjax', accountname: NAME, assigned_user_id: '1', __vtrftk: await token(page) },
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  })
  const result = await response.json() as { success: boolean; result: { _recordId: number } }
  expect(result.success).toBe(true)
  id = String(result.result._recordId)
  created.push({ module: 'Accounts', id })
  await page.close()
})

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage()
  try {
    for (const record of [...created].reverse()) await deleteSynthetic(page, record.module, record.id, 'MU13')
  } finally {
    await page.goto('index.php?module=Accounts&view=List&modernui=on')
    await patchGlobal(page, { 'layout.modules': oldLayout ?? null, 'theme.mode': oldMode ?? null })
    await clearPersonal(page)
    if (Object.keys(personal).length) expect((await savePersonal(page, personal)).ok).toBe(true)
    await page.close()
  }
})

test('Summary, Details, search, related tabs and history preserve the list URL and native fields', async ({ page }) => {
  const errors = watchErrors(page)
  // Previous/next are a native ListViewSession contract: compare both views with the same source filter.
  await page.goto(`index.php?module=Accounts&view=List&modernui=on${search}`)
  await waitForShell(page)
  await page.goto(`index.php?module=Accounts&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full&modernui=off`)
  await settle(page)
  const baseline = await recordContract(page)
  await page.goto(`index.php?module=Accounts&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full&modernui=on`)
  await waitForShell(page)
  await expect(page.locator('.mu-record-search input')).toBeVisible()
  expect(await recordContract(page)).toEqual(baseline)
  await openCloudRecord(page, 'Accounts', id, search)
  const title = await page.locator('#overlayPageContent .recordLabel').boundingBox()
  const titleRow = await page.locator('#overlayPageContent .recordBasicInfo > .info-row').first().boundingBox()
  expect(title).not.toBeNull()
  expect(titleRow).not.toBeNull()
  expect((title?.y ?? 0) + (title?.height ?? 0), 'the title line fits its row without clipping')
    .toBeLessThanOrEqual((titleRow?.y ?? 0) + (titleRow?.height ?? 0))
  const listUrl = page.url()
  await recordTab(page, '[data-link-key="LBL_RECORD_DETAILS"]')
  expect(page.url()).toBe(listUrl)
  const contract = await recordContract(page)
  expect(contract.fields).toEqual(baseline.fields)
  expect(contract.actions).toEqual(baseline.actions)
  const fieldSearch = page.locator('.mu-record-search input')
  await expect(fieldSearch).toBeVisible()
  await fieldSearch.fill('MU13 no such field')
  await expect(page.locator('.mu-record-empty')).toBeVisible()
  await expect(page.locator('#detailView .block:visible')).toHaveCount(0)
  await fieldSearch.fill('')
  expect((await recordContract(page)).fields).toEqual(baseline.fields)
  await page.locator('.mu-record-sections button').last().click()
  await expect(page.locator('.mu-record-sections button').last()).toHaveClass(/active/)
  for (const tab of ['[data-label-key="LBL_UPDATES"]', '[data-module="ModComments"]', '[data-module="Documents"]', '[data-link-key="LBL_RECORD_SUMMARY"]']) {
    if (await page.locator(`#overlayPageContent .related-tabs ${tab}`).count()) {
      await recordTab(page, tab)
      expect(page.url()).toBe(listUrl)
      await expect(page.locator('#overlayPageContent .details')).not.toBeEmpty()
    }
  }
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-mu-record', id)
  await page.locator('.mu-record-back').click()
  await expect(page.locator('html')).not.toHaveAttribute('data-mu-record')
  expect(page.url()).toBe(listUrl)
  expect(errors.page).toEqual([])
})

test('inline save and a real comment use native handlers once and persist after reopening', async ({ page }) => {
  await openCloudRecord(page, 'Accounts', id, search)
  await recordTab(page, '[data-link-key="LBL_RECORD_DETAILS"]')
  const cell = page.locator('#overlayPageContent #Accounts_detailView_fieldValue_bill_city')
  await cell.hover()
  await cell.locator('.editAction').click()
  await cell.locator('input[name="bill_city"]').fill('MU13 Berlin Ä Москва')
  const saved = page.waitForResponse((response) => response.request().method() === 'POST'
    && (response.request().postData() ?? '').includes('action=SaveAjax'), { timeout: 15_000 })
  await cell.locator('.inlineAjaxSave').click()
  expect((await (await saved).json() as { success: boolean }).success).toBe(true)
  await expect(cell.locator('.value')).toContainText('MU13 Berlin Ä Москва')
  await recordTab(page, '[data-link-key="LBL_RECORD_SUMMARY"]')
  const comment = page.locator('#overlayPageContent textarea.commentcontent').first()
  await comment.fill('MU13 synthetic comment Ä')
  const response = page.waitForResponse((answer) => {
    const data = new Map(payload(answer.request()))
    return data.get('module') === 'ModComments' && data.get('action') === 'SaveAjax'
  }, { timeout: 15_000 })
  await page.locator('#overlayPageContent .detailViewSaveComment, #overlayPageContent .saveComment').first().click()
  const body = await (await response).json() as { success: boolean; result: { _recordId?: string | number; id?: string | number } }
  expect(body.success).toBe(true)
  const commentId = body.result._recordId ?? body.result.id
  if (commentId !== undefined) created.push({ module: 'ModComments', id: String(commentId) })
  await page.locator('.mu-record-back').click()
  await expect(page.locator('html')).not.toHaveAttribute('data-mu-record')
  await page.goto(`index.php?module=Accounts&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full&modernui=off`)
  await expect(page.locator('#Accounts_detailView_fieldValue_bill_city .value')).toContainText('MU13 Berlin Ä Москва')
  await page.goto(`index.php?module=Accounts&view=Detail&record=${id}&modernui=off`)
  await expect(page.locator('.commentInfoContent').filter({ hasText: 'MU13 synthetic comment Ä' }).first()).toBeVisible()
})

test('inventory, documents and custom modules keep their native actions, authorised fields and line items', async ({ page }) => {
  test.setTimeout(240_000)
  await page.goto('index.php?module=Documents&view=List&modernui=on')
  // A clean seed need not contain a document. Create our own through the native action, as on the dev stand.
  await fixture(page, 'Documents', { notes_title: `${NAME} Module Document`, filelocationtype: 'E', filename: 'https://example.invalid/mu13', filestatus: '1' })
  const extra = (process.env['MU_RECORD_MODULES'] ?? '').split(',').filter((module) => /^[A-Za-z0-9_]+$/.test(module))
  const orderBy = new URLSearchParams(process.env['MU_RECORD_ORDER_BY'] ?? '')
  for (const module of ['SalesOrder', 'Documents', ...(isClean ? ['Gadgets'] : extra)]) {
    await page.goto(`index.php?module=${module}&view=List&modernui=on&search_params=%5B%5D&page=1`)
    await waitForShell(page)
    const all = await page.locator('.lists-menu a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('data-filter-id')
    if (all !== null) { await page.goto(`index.php?module=${module}&view=List&viewname=${all}&search_params=%5B%5D&page=1&modernui=on`); await waitForShell(page) }
    // Imported rows can share modifiedtime: native navigation then has no stable tie-breaker. A private test
    // profile can select a unique sortable field; it applies to both views and never changes the action assertion.
    const sortField = orderBy.get(module)
    if (sortField !== null) {
      expect(sortField).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/)
      const orderedList = new URL(page.url())
      orderedList.searchParams.set('orderby', sortField)
      orderedList.searchParams.set('sortorder', 'ASC')
      await page.goto(orderedList.href)
      await waitForShell(page)
    }
    const first = page.locator('#listViewContent tr.listViewEntries[data-id]').first()
    const record = await first.getAttribute('data-id')
    expect(record, `${module}: a fixture exists`).toMatch(/^\d+$/)
    // Previous/next belong to the source list's filter and order. Reopen exactly that list for the themed comparison.
    const listContext = new URL(page.url()).searchParams
    for (const key of ['module', 'view', 'modernui']) listContext.delete(key)
    await page.goto(`index.php?module=${module}&view=Detail&record=${record ?? ''}&mode=showDetailViewByMode&requestMode=full&modernui=off`)
    await settle(page)
    const baseline = await recordContract(page)
    await openCloudRecord(page, module, record ?? '', `&${listContext.toString()}`)
    if (await page.locator('.related-tabs [data-link-key="LBL_RECORD_DETAILS"]').count()) {
      await recordTab(page, '[data-link-key="LBL_RECORD_DETAILS"]')
    }
    expect(await recordContract(page), module).toEqual(baseline)
    await page.locator('.mu-record-actions-toggle').click()
    // Every native action is reachable in its original menu. Test hit targets, not only the presence of hidden nodes.
    const buttons = page.locator('.detailViewButtoncontainer .btn:visible')
    for (const button of await buttons.all()) {
      if (await button.isEnabled()) await button.click({ trial: true })
    }
    await page.keyboard.press('Escape')
    await expect(page.locator('html')).toHaveAttribute('data-mu-record', record ?? '')
    await page.locator('.mu-record-back').click()
  }
})

test('RU/EN/DE, widths, zoom, keyboard focus and overflow actions', async ({ page }) => {
  test.setTimeout(180_000)
  for (const locale of ['ru-RU', 'en-US', 'de-DE']) {
    await page.goto('index.php?module=Accounts&view=List&modernui=on')
    expect((await savePersonal(page, { locale })).ok).toBe(true)
    for (const width of [1440, 1024, 768, 412]) {
      await page.setViewportSize({ width, height: 1000 })
      await openCloudRecord(page, 'Accounts', id, search)
      await recordTab(page, '[data-link-key="LBL_RECORD_DETAILS"]')
      const box = await page.locator('#overlayPageContent').boundingBox()
      expect(box).not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width)
      expect(await page.locator('.mu-record-search input').getAttribute('placeholder')).not.toMatch(/^record\./)
      await page.locator('.mu-record-actions-toggle').click()
      await page.locator('.detailViewButtoncontainer [id$="_LBL_EDIT"]').click({ trial: true })
      await page.keyboard.press('Escape')
      await expect(page.locator('html')).toHaveAttribute('data-mu-record', id)
      await page.locator('.mu-record-back').focus()
      await page.keyboard.press('Shift+Tab')
      expect(await page.evaluate(() => document.getElementById('overlayPageContent')?.contains(document.activeElement))).toBe(true)
      await page.keyboard.press('Escape')
      await expect(page.locator('html')).not.toHaveAttribute('data-mu-record')
    }
  }
  await page.setViewportSize({ width: 720, height: 500 }) // CSS viewport of 1440x1000 at browser zoom 200%.
  await openCloudRecord(page, 'Accounts', id, search)
  await recordTab(page, '[data-link-key="LBL_RECORD_DETAILS"]')
  await expect(page.locator('.mu-record-search input')).toBeInViewport()
  await page.locator('.mu-record-back').click()
})

test('related contacts: quick create, pagination, sort, row actions and unlink preserve the parent', async ({ page }) => {
  test.setTimeout(240_000)
  await openCloudRecord(page, 'Accounts', id, search)
  const contact = await fixture(page, 'Contacts', { firstname: 'MU13', lastname: `${NAME} Contact`, account_id: id })
  await recordTab(page, '[data-module="Contacts"]')
  const related = page.locator('#overlayPageContent .relatedContainer')
  await expect(related.locator(`tr[data-id="${contact}"]`)).toBeVisible()
  const before = page.url()
  await related.locator('button.addButton').click()
  const quick = page.locator('form[name="QuickCreate"]')
  await expect(quick).toBeVisible()
  const copyAddress = page.locator('.bootbox [data-bb-handler="cancel"]')
  await copyAddress.waitFor({ state: 'visible', timeout: 3000 }).catch(() => { /* No address confirmation in some profiles. */ })
  if (await copyAddress.isVisible()) await copyAddress.click()
  await quick.locator('[name="lastname"]').fill(`${NAME} Quick Contact`)
  expect(await fillMandatory(page, 'on', 'form[name="QuickCreate"]')).toEqual([])
  const saved = page.waitForResponse((response) => {
    const data = new Map(payload(response.request()))
    return data.get('module') === 'Contacts' && data.get('action') === 'SaveAjax'
  }, { timeout: 15_000 })
  await quick.locator('[type="submit"]').click()
  const savedBody = await (await saved).json() as { success: boolean; result: { _recordId: number } }
  expect(savedBody.success).toBe(true)
  created.push({ module: 'Contacts', id: String(savedBody.result._recordId) })
  expect(new Map(payload((await saved).request())).get('account_id')).toBe(id)
  await expect(quick).toBeHidden()
  await expect(related.locator('tr.listViewEntries')).toHaveCount(2)
  if (await copyAddress.isVisible()) await copyAddress.click()
  expect(page.url()).toBe(before)

  // Real pagination over synthetic rows. The CRM owns the page size; no test changes a user's preference.
  const limit = Number(await related.locator('#pageLimit').inputValue())
  expect(limit).toBeGreaterThan(0); expect(limit).toBeLessThanOrEqual(100)
  for (let index = 0; index < limit; index++) {
    await fixture(page, 'Contacts', { lastname: `${NAME} Page ${String(index).padStart(3, '0')}`, account_id: id })
  }
  await recordTab(page, '[data-link-key="LBL_RECORD_SUMMARY"]')
  await recordTab(page, '[data-module="Contacts"]')
  await expect(related.locator('tr.listViewEntries')).toHaveCount(limit)
  const firstPage = await related.locator('tr.listViewEntries').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-id')))
  await related.locator('#NextPageButton').click()
  await expect(related.locator('[name="currentPageNum"]')).toHaveValue('2')
  await expect(related.locator('tr.listViewEntries')).toHaveCount(2)
  const secondPage = await related.locator('tr.listViewEntries').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-id')))
  expect(secondPage.length).toBe(2)
  expect(secondPage.some((value) => firstPage.includes(value))).toBe(false)
  await related.locator('#PreviousPageButton').click()
  await expect(related.locator('[name="currentPageNum"]')).toHaveValue('1')
  await expect(related.locator('tr.listViewEntries')).toHaveCount(limit)
  await related.locator('.listViewContentHeaderValues[data-fieldname="lastname"]').click()
  await settle(page)
  const field = related.locator('.searchRow [name="lastname"]')
  await field.fill(`${NAME} Contact`)
  await related.locator('[data-trigger="relatedListSearch"]').click()
  await expect(related.locator('tr.listViewEntries')).toHaveCount(1)
  const row = related.locator(`tr[data-id="${contact}"]`)
  const opened = page.context().waitForEvent('page')
  await row.locator('.relatedListEntryValues a').first().click()
  const recordPage = await opened
  await recordPage.waitForURL(/view=Detail/)
  await expect(recordPage.locator('.recordLabel').first()).toContainText('MU13')
  await recordPage.close()
  await expect(page.locator('html')).toHaveAttribute('data-mu-record', id)
  const edited = page.context().waitForEvent('page')
  await row.locator('[name="relationEdit"]').click()
  const editPage = await edited
  await editPage.waitForURL(/view=Edit/)
  await expect(editPage.locator('form#EditView [name="lastname"]')).toHaveValue(`${NAME} Contact`)
  await editPage.close()
  await row.locator('.relationDelete').click()
  await page.locator('.bootbox [data-bb-handler="confirm"]').click()
  await expect(row).toHaveCount(0)
  expect(page.url()).toBe(before)
  await page.locator('.mu-record-back').click()
  await expect(page.locator('html')).not.toHaveAttribute('data-mu-record')
})

test('related documents select and unlink an existing synthetic document through native handlers', async ({ page }) => {
  await openCloudRecord(page, 'Accounts', id, search)
  const document = await fixture(page, 'Documents', {
    notes_title: `${NAME} Document`, filename: 'https://example.invalid/MU13', filelocationtype: 'E', filestatus: '1',
  })
  await recordTab(page, '[data-module="Documents"]')
  const related = page.locator('#overlayPageContent .relatedContainer')
  await pickInPopup(page, () => related.locator('button.selectRelation').click(), 'notes_title', `${NAME} Document`)
  const row = related.locator(`tr[data-id="${document}"]`)
  await expect(row).toBeVisible()
  await row.locator('.relationDelete').click()
  await page.locator('.bootbox [data-bb-handler="confirm"]').click()
  await expect(row).toHaveCount(0)
  await page.locator('.mu-record-back').click()
})

test('403/500, slow responses, missing scripts, deleted and mismatched records retain a usable native fallback', async ({ page }) => {
  test.setTimeout(180_000)
  for (const status of [403, 500]) {
    await page.route(route, (request) => request.fulfill({ status, body: 'Unavailable' }))
    await page.goto(`index.php?module=Accounts&view=List&modernui=on${search}`)
    await waitForShell(page)
    await page.locator(`tr[data-id="${id}"] a[href*="view=Detail"]`).filter({ visible: true }).first().click()
    await page.waitForURL(/view=Detail/)
    await expect(page.locator('.recordLabel').first()).toContainText(NAME)
    await page.unroute(route)
  }
  await page.route(route, async (request) => { await new Promise((resolve) => setTimeout(resolve, 1200)); await request.continue() })
  await openCloudRecord(page, 'Accounts', id, search)
  await page.locator('.mu-record-back').click()
  await page.unroute(route)
  const deleted = await fixture(page, 'Accounts', { accountname: `${NAME} Deleted` })
  await deleteSynthetic(page, 'Accounts', deleted, 'MU13')
  created.splice(created.findIndex((record) => record.id === deleted), 1)
  const removed = await page.request.get(`index.php?module=ModernUI&view=Record&sourceModule=Accounts&record=${deleted}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
  expect(await removed.text()).not.toContain('class="overlayDetail mu-cloud-record')
  for (const [module, record] of [['Accounts', '999999999'], ['Contacts', id], ['Users', '1'], ['Accounts/../../Users', id]]) {
    const response = await page.request.get(`index.php?module=ModernUI&view=Record&sourceModule=${encodeURIComponent(module ?? '')}&record=${record ?? ''}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    expect(await response.text()).not.toContain('class="overlayDetail mu-cloud-record')
  }
  await page.route('**/modules/Vtiger/resources/Detail.js*', (request) => request.abort())
  await page.goto(`index.php?module=Accounts&view=List&modernui=on${search}`)
  await waitForShell(page)
  await page.locator(`tr[data-id="${id}"] a[href*="view=Detail"]`).filter({ visible: true }).first().click()
  await page.waitForURL(/view=Detail/)
  await expect(page.locator('.recordLabel').first()).toContainText(NAME)
  await page.unroute('**/modules/Vtiger/resources/Detail.js*')
})

test('restricted user: private records are refused; hidden and read-only fields match native Detail', async ({ browser }) => {
  test.skip(!isClean, 'synthetic restricted user exists on the clean stand')
  const context = await browser.newContext({ baseURL: crmUrl(), storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  try {
    await isolateNetwork(context)
    await signIn(page, cleanUserCredentials('limited'))
    await page.goto('index.php?module=Accounts&view=List&modernui=on')
    const own = await page.locator('tr.listViewEntries', { hasText: 'Müller & Söhne GmbH' }).first().getAttribute('data-id') ?? ''
    await page.goto(`index.php?module=Accounts&view=Detail&record=${own}&mode=showDetailViewByMode&requestMode=full&modernui=off`)
    const baseline = await recordContract(page)
    await openCloudRecord(page, 'Accounts', own)
    await recordTab(page, '[data-link-key="LBL_RECORD_DETAILS"]')
    expect(await recordContract(page)).toEqual(baseline)
    await expect(page.locator('#Accounts_detailView_fieldValue_annual_revenue')).toHaveCount(0)
    await expect(page.locator('#Accounts_detailView_fieldValue_phone .editAction')).toHaveCount(0)
    const response = await page.request.get(`index.php?module=ModernUI&view=Record&sourceModule=Accounts&record=${id}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    expect(await response.text()).not.toContain(NAME)
    expect(await response.text()).not.toContain('class="overlayDetail mu-cloud-record')
  } finally { await context.close() }
})
