/**
 * Stage 07 — record views, forms and line items under the theme, as an administrator (and on the clean stand also the
 * restricted user U), on the dev instance and the clean stand (project "records"). Every check compares v7 with v7
 * under the theme: the same page is opened with the theme off (safe mode of the session) and on, and what v7 shows
 * and sends must be the same:
 *
 * - record views: buttons of the header (extensions included), related tabs, blocks, widgets, values, inline edit
 *   pencils, line items; labels of the related tabs do not run into each other;
 * - create, edit and quick create forms: every control in DOM order with its value, visibility, mandatory, disabled
 *   and read-only state, and what a submit would send; picklist changes (dynamic fields of extensions such as
 *   Conditional Layouts, dynamic blocks, picklist dependencies) show, hide and require the same fields;
 * - line items: products/services from the popup, quantities, line and overall discounts, tax mode, adjustment, a
 *   row added, deleted and moved — the same totals and the same payload;
 * - saving: organization, contact and sales order with line items created through the standard forms — the same
 *   request body, the same saved values and line items when the record is opened again; Enter in a field and a double
 *   click on Save send one request (or none), as v7 does;
 * - errors: empty mandatory field and wrong formats are shown and nothing is sent, typed values stay; inline edit
 *   through the events of v7, a refusal of the server and an expired session are visible and keep the record as it
 *   was; cancel saves nothing;
 * - rights (clean stand): read-only and hidden fields of U, a record of another user refused;
 * - the language of the theme (RU, EN, DE) changes neither the form nor its payload.
 *
 * Writes only synthetic records with the marker MU07 (deleted at the end). On the dev instance the sales order has
 * only services in its line items (no stock moves) and a "!" in its subject (instances may keep such orders out of their
 * stock workflows); its outgoing integrations are off (checked before the run, docs/DEVELOPMENT.md). MU_E2E_LOCAL_BUILD=1 serves the module's resources from the local
 * build (clean stand during the work; not a PACKAGE proof).
 */
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type Request } from '@playwright/test'
import { adminCredentials, cleanUserCredentials, crmUrl, isClean, repoRoot, stateFile, target } from './env'
import { SETTINGS_FORMS, isolateNetwork, signIn, useLocalBuild } from './support'
import {
  MARK, MODES, choose, deleteSynthetic, fillMandatory, formData, formState, isSave, lineItems, marker, normalise, normaliseText,
  openIn, payload, pickInPopup, recordState, settle, type Mode,
} from './records-support'
import { bootstrap, clearPersonal, savePersonal } from './settings-api'

test.describe.configure({ mode: 'serial' })

const localBuild = process.env['MU_E2E_LOCAL_BUILD'] === '1'
interface Item {
  module: 'Products' | 'Services'
  field: string
  name: string
  qty: string
}

/**
 * Line items of the inventory scenarios: products and a service of the seed on the clean stand; on the dev instance only
 * active services (no stock moves), read at run time (names of a real instance stay out of git).
 */
let ITEMS: Item[] = isClean
  ? [
      { module: 'Products', field: 'productname', name: 'Fenster Typ Ä', qty: '3' },
      { module: 'Services', field: 'servicename', name: 'Montage / Монтаж', qty: '2' },
      { module: 'Products', field: 'productname', name: 'Widget Pro', qty: '5' },
    ]
  : []

async function serviceItems(page: Page): Promise<Item[]> {
  // Inventory popups exclude inactive services. A previous list test may have changed the default sort/filter.
  const search = encodeURIComponent(JSON.stringify([[['discontinued', 'e', '1']]]))
  await page.goto(`index.php?module=Services&view=List&search_params=${search}&page=1&modernui=on`)
  const names = await page.locator('tr.listViewEntries[data-id] td.listViewEntryValue[data-name="servicename"], tr.listViewEntries[data-id] td[data-name="servicename"]')
    .evaluateAll((cells) => cells.map((cell) => (cell.getAttribute('data-rawvalue') ?? cell.textContent).replace(/\s+/g, ' ').trim()).filter((name) => name !== ''))
  const unique = [...new Set(names)].slice(0, 3)
  expect(unique.length, 'three services on the instance').toBe(3)
  return unique.map((name, index) => ({ module: 'Services', field: 'servicename', name, qty: String(index + 1) }))
}

const created: { module: string; id: string }[] = []
let originalPersonal: Record<string, unknown> = {}

async function prepare(context: BrowserContext, page: Page): Promise<void> {
  await isolateNetwork(context)
  if (localBuild) {
    await useLocalBuild(context)
  }
  page.on('dialog', (dialog) => {
    void dialog.accept()
  })
}

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: stateFile('admin') })
  const page = await context.newPage()
  await prepare(context, page)
  return page
}

test.beforeAll(async ({ browser }) => {
  const page = await adminPage(browser)
  if (ITEMS.length === 0) {
    ITEMS = await serviceItems(page)
  }
  await openIn(page, 'index.php?module=Home&view=DashBoard', 'on')
  originalPersonal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  await page.context().close()
})

test.afterAll(async ({ browser }) => {
  const page = await adminPage(browser)
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  const failed: string[] = []
  for (const record of [...created].reverse()) {
    try {
      await deleteSynthetic(page, record.module, record.id)
    } catch (error) {
      failed.push(`${record.module} ${record.id}: ${String(error)}`)
    }
  }
  await clearPersonal(page)
  if (Object.keys(originalPersonal).length > 0) {
    expect((await savePersonal(page, originalPersonal)).ok).toBe(true)
  }
  await page.context().close()
  expect(failed, 'synthetic records left').toEqual([])
})

test.beforeEach(async ({ context, page }) => {
  await prepare(context, page)
})

/** First record of a list (the default order of the list). */
async function firstRecord(page: Page, module: string): Promise<string | null> {
  await page.goto(`index.php?module=${module}&view=List&modernui=on`)
  return page.locator('tr.listViewEntries[data-id]').first().getAttribute('data-id', { timeout: 10_000 }).catch(() => null)
}

/** Pairs of neighbouring related tab labels whose text boxes run into each other (more than 1 px). */
async function tabOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.related-tabs .nav-tabs > li > a .tab-label'))
      .filter((element) => element.getClientRects().length > 0 && element.textContent.trim() !== '')
      .map((element) => { const box = element.getBoundingClientRect(); return { right: box.right, left: box.left, top: box.top, text: element.textContent.trim() } })
    const found: string[] = []
    for (let index = 1; index < labels.length; index++) {
      const previous = labels[index - 1]
      const current = labels[index]
      if (previous !== undefined && current !== undefined && Math.abs(previous.top - current.top) < 4 && previous.right > current.left + 1) {
        found.push(`${previous.text} / ${current.text}`)
      }
    }
    return found
  })
}

/**
 * Modules whose forms an instance changes with extensions (Conditional Layouts rules, dynamic blocks): MU_E2E_FORM_MODULES
 * adds them to the checks of forms and dynamic fields (the obligatory matrix of the dev instance names them).
 */
const FORM_MODULES = (process.env['MU_E2E_FORM_MODULES'] ?? '').split(',').map((name) => name.trim()).filter((name) => /^[A-Za-z0-9_]+$/.test(name))

const RECORD_MODULES = isClean ? ['Accounts', 'Contacts', 'Potentials', 'SalesOrder', 'Quotes', 'Invoice', 'PurchaseOrder', 'HelpDesk', 'Gadgets'] : ['Accounts', 'Contacts', 'Potentials', 'SalesOrder', 'Invoice', 'HelpDesk']

test('record views: header actions, tabs, blocks, widgets, values and inline edit of v7; tab labels overlap no more than in v7', async ({ page }) => {
  for (const module of RECORD_MODULES) {
    const id = await firstRecord(page, module)
    if (id === null) {
      continue
    }
    for (const view of ['', '&mode=showDetailViewByMode&requestMode=full', '&mode=showRecentActivities&page=1']) {
      const url = `index.php?module=${module}&view=Detail&record=${id}${view}`
      const shapes: Record<string, Record<string, string[]>> = {}
      const overlaps: Record<string, string[]> = {}
      for (const mode of MODES) {
        await openIn(page, url, mode)
        shapes[mode] = await recordState(page)
        overlaps[mode] = await tabOverlaps(page)
      }
      expect(shapes['on'], `${module}${view}`).toEqual(shapes['off'])
      if (!view.includes('RecentActivities')) {
        expect(shapes['on']?.['fields']?.length ?? 0, `${module}${view}: values`).toBeGreaterThan(0)
      }
      // Labels of neighbouring related tabs (fixed 90 px per tab in v7) run into each other no more than in v7.
      for (const overlap of overlaps['on'] ?? []) {
        expect(overlaps['off'] ?? [], `${module}: related tab labels`).toContain(overlap)
      }
    }
  }
})

test('forms: create, edit and quick create show the same controls, values, mandatory, hidden and read-only state as v7', async ({ page }) => {
  const forms: { name: string; url: string }[] = []
  for (const module of ['Accounts', 'Contacts', 'Potentials', 'SalesOrder', ...(isClean ? ['Quotes', 'PurchaseOrder', 'Gadgets'] : ['Invoice']), ...FORM_MODULES]) {
    forms.push({ name: `${module} create`, url: `index.php?module=${module}&view=Edit` })
    const id = await firstRecord(page, module)
    if (id !== null) {
      forms.push({ name: `${module} edit`, url: `index.php?module=${module}&view=Edit&record=${id}` })
    }
  }
  for (const form of forms) {
    const states: Record<string, unknown> = {}
    for (const mode of MODES) {
      await openIn(page, form.url, mode)
      states[mode] = { controls: await formState(page), data: await formData(page) }
    }
    expect(states['on'], form.name).toEqual(states['off'])
  }
  for (const module of ['Contacts', 'Accounts']) {
    const states: Record<string, unknown> = {}
    for (const mode of MODES) {
      await openIn(page, 'index.php?module=Home&view=DashBoard', mode)
      await page.locator('#menubar_quickCreate').click()
      await page.locator(`#menubar_quickCreate_${module}`).click()
      const quick = page.locator('.modal form[name="QuickCreate"]')
      await expect(quick).toBeVisible()
      await settle(page)
      states[mode] = { controls: await formState(page, '.modal form[name="QuickCreate"]'), data: await formData(page, '.modal form[name="QuickCreate"]') }
      // The footer of the quick create (Save, Cancel, full form) stays reachable above the form.
      const save = page.locator('.modal form[name="QuickCreate"] button[type="submit"]').first()
      await expect(save).toBeVisible()
      const hit = await save.evaluate((button) => {
        const box = button.getBoundingClientRect()
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
        return top !== null && (top === button || button.contains(top))
      })
      expect(hit, `${module} quick create: Save on top (${mode})`).toBe(true)
      // v7 opens the quick create without keyboard closing: its own close button.
      await page.locator('.modal.in [data-dismiss="modal"]').first().click()
      await expect(quick).toBeHidden()
    }
    expect(states['on'], `${module} quick create`).toEqual(states['off'])
  }
})

test('dynamic fields: picklist changes show, hide and require the same fields as v7 (extensions included)', async ({ page }) => {
  for (const module of ['SalesOrder', 'Contacts', 'Accounts', 'Potentials', ...FORM_MODULES]) {
    const url = `index.php?module=${module}&view=Edit`
    const runs: Record<string, unknown[]> = {}
    for (const mode of MODES) {
      await openIn(page, url, mode)
      const selects = await page.locator('form#EditView .fieldBlockContainer select[name]').evaluateAll((elements) => elements
        .filter((element) => element.closest('td')?.getClientRects().length !== 0)
        .map((element) => {
          const select = element as HTMLSelectElement
          return { name: select.name, multiple: select.multiple, options: Array.from(select.options).map((option) => option.value).filter((value) => value !== '') }
        })
        .filter((select) => !/assigned_user_id|_id$|currency|region|taxtype/.test(select.name) && select.options.length > 0 && select.options.length <= 40)
        .slice(0, 24))
      // About 48 changes per form: every value of a few pick-lists, the first values of many.
      const per = Math.max(2, Math.floor(48 / Math.max(1, selects.length)))
      const states: unknown[] = []
      const visibleShape = async (): Promise<unknown> => (await formState(page)).map((field) => [field.name, field.cell, field.self, field.required, field.disabled, field.readonly, field.label])
      for (const select of selects) {
        const choices: string[][] = select.options.slice(0, per).map((value) => [value])
        if (select.multiple && select.options.length > 1) {
          choices.push(select.options.slice(0, 2))
          choices.push([])
        }
        for (const values of choices) {
          await choose(page, `form#EditView select[name="${select.name}"]`, values)
          await settle(page)
          states.push([select.name, values, await visibleShape()])
        }
      }
      runs[mode] = states
    }
    expect(runs['on'], module).toEqual(runs['off'])
    expect(runs['off']?.length ?? 0, `${module}: picklists exercised`).toBeGreaterThan(0)
  }
})

/** Adds the line items of ITEMS, discounts and an adjustment in an open inventory edit form; deletes a row and moves one. */
async function buildLineItems(page: Page, reorder = true): Promise<void> {
  const rows = page.locator('#lineItemTab tr.lineItemRow:not(#row0):not(.lineItemCloneCopy)')
  for (const [index, item] of ITEMS.entries()) {
    if (index > 0 || (await rows.count()) === 0) {
      await page.locator(item.module === 'Services' ? '#addService' : '#addProduct').first().click()
    }
    const row = rows.nth(index)
    await expect(row).toBeVisible()
    await pickInPopup(page, () => row.locator(`.lineItemPopup[data-module-name="${item.module}"]`).click(), item.field, item.name)
    await expect(row.locator('.productName')).toHaveValue(item.name)
    await row.locator('.qty').fill(item.qty)
    await row.locator('.qty').blur()
  }
  // A percentage discount on the first line (the popover of v7), an amount on the overall total, an adjustment. v7 keeps
  // its popovers in the DOM and hides them with opacity 0: the open one is the one drawn opaque.
  const opaque = async (popover: Locator, shown: boolean): Promise<void> => {
    await expect.poll(async () => popover.evaluate((element) => getComputedStyle(element).opacity)).toBe(shown ? '1' : '0')
  }
  await rows.nth(0).locator('.individualDiscount').click()
  const discount = page.locator('.popover.discountForm').last()
  await opaque(discount, true)
  await discount.locator('[data-discount-type="percentage"]').check()
  await discount.locator('.discount_percentage').fill('10')
  await discount.locator('.popoverButton').click()
  await opaque(discount, false).catch(() => undefined)
  // The overall discount, where the instance shows it (a modified layout of the totals may leave it out).
  if (await page.locator('#finalDiscount').isVisible()) {
    await page.locator('#finalDiscount').click()
    const final = page.locator('.popover:has(#finalDiscountUI)').first()
    await opaque(final, true)
    await final.locator('[data-discount-type="amount"]').check()
    await final.locator('[name="discount_amount_final"]').fill('5')
    await final.locator('.popoverButton').click()
    await opaque(final, false).catch(() => undefined)
  }
  await page.locator('#adjustment').fill('2.5')
  await page.locator('#adjustment').blur()
  // The last row is removed, the second one moved to the top (jQuery UI sortable of v7; dragged by a cell without a
  // control — sortable ignores inputs, and its drag image would start a native image drag instead).
  await rows.last().locator('.deleteRow').click()
  await expect(rows).toHaveCount(ITEMS.length - 1)
  // jQuery UI sortable (tolerance "pointer") moves the row once the pointer is over the upper half of the row above.
  const nameOf = async (index: number): Promise<string> => rows.nth(index).locator('.productName').inputValue()
  const second = await nameOf(1)
  for (let attempt = 0; reorder && attempt < 3 && (await nameOf(0)) !== second; attempt++) {
    const from = await rows.nth(1).locator('.productTotal').boundingBox()
    const to = await rows.nth(0).boundingBox()
    if (from === null || to === null) {
      break
    }
    const x = from.x + from.width / 2
    await page.mouse.move(x, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(x, from.y - 10, { steps: 5 })
    await page.mouse.move(x, to.y + to.height / 2, { steps: 10 })
    await page.mouse.move(x, to.y + 4, { steps: 10 })
    await page.waitForTimeout(150)
    await page.mouse.up()
    // sortable animates the drop (revert: true) with a placeholder row until it is done.
    await expect(page.locator('#lineItemTab .ui-sortable-placeholder, #lineItemTab .ui-sortable-helper')).toHaveCount(0)
  }
  if (reorder) {
    expect(await nameOf(0), 'the second row moved to the top').toBe(second)
  }
  await settle(page)
}

const INVENTORY = isClean ? ['SalesOrder', 'Quotes', 'Invoice', 'PurchaseOrder'] : ['SalesOrder', 'Invoice']

for (const module of INVENTORY) {
test(`line items of ${module}: popup, quantities, discounts, tax mode, adjustment, rows added, deleted and moved — totals and payload as v7`, async ({ page }) => {
  const runs: Record<string, unknown> = {}
  for (const mode of MODES) {
    await openIn(page, `index.php?module=${module}&view=Edit`, mode)
    // Moving rows (jQuery UI sortable of Inventory_Edit_Js, the same code in every inventory module) — in the order form.
    await buildLineItems(page, module === 'SalesOrder')
    const grouped = await lineItems(page)
    const taxModes = await page.locator('#taxtype option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
    const other = taxModes.find((value) => value !== grouped.totals['taxtype'])
    let switched: unknown = null
    if (other !== undefined) {
      await choose(page, '#taxtype', [other])
      await settle(page)
      switched = await lineItems(page)
    }
    runs[mode] = { grouped, switched, data: normalise(await formData(page), mode) }
  }
  expect(runs['on']).toEqual(runs['off'])
  const grouped = (runs['off'] as { grouped: { rows: string[][] } }).grouped
  expect(grouped.rows.map((row) => row[0])).toEqual(module === 'SalesOrder' ? [ITEMS[1]?.name, ITEMS[0]?.name] : [ITEMS[0]?.name, ITEMS[1]?.name])
})
}

interface Saved {
  id: string
  body: [string, string][]
  view: Record<string, string[]>
}

/** Fills and saves a create form with the theme off or on; the record view of the saved record afterwards. */
async function createThrough(page: Page, module: string, mode: Mode, fill: (page: Page) => Promise<void>): Promise<Saved> {
  await openIn(page, `index.php?module=${module}&view=Edit`, mode)
  await fill(page)
  expect(await fillMandatory(page, mode), `${module}: mandatory references`).toEqual([])
  const request = page.waitForRequest(isSave(module), { timeout: 60_000 })
  try {
    await page.locator('form#EditView button[type="submit"]:visible').last().click({ timeout: 20_000 })
    await page.waitForURL((url) => url.searchParams.get('module') === module && url.searchParams.get('view') === 'Detail' && /^\d+$/.test(url.searchParams.get('record') ?? ''), { timeout: 60_000 })
  } catch (error) {
    // What v7 shows instead of the record (a message of the validator, a dialog of an extension) makes the failure readable.
    const shown = await page.locator('.qtip:visible, .vt-notification:visible, .modal.in, .alert:visible').evaluateAll((elements) => elements
      .map((element) => `${element.getAttribute('class') ?? ''}: ${(element as HTMLElement).innerText}`)).catch(() => [])
    throw new Error(`${module} (${mode}) not saved: ${page.url()} — ${shown.join(' | ').replace(/\s+/g, ' ').slice(0, 400)}`, { cause: error })
  }
  const body = normalise(payload(await request), mode)
  const id = new URL(page.url()).searchParams.get('record') ?? ''
  created.push({ module, id })
  await openIn(page, `index.php?module=${module}&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full`, mode)
  const view = await recordState(page)
  return { id, body, view }
}

/** Fields whose values differ between two records by nature (numbers, times, the record itself). */
const VOLATILE = /_(?:no|createdtime|modifiedtime|modifiedby|starred|tags|record_id|source|last_modified|creator|smcreatorid)\||fieldValue_(?:createdtime|modifiedtime|modifiedby|salesorder_no|account_no|contact_no|potential_no|invoice_no|quote_no|purchaseorder_no|ticket_no|cf_\d+_no)\|/

function comparable(saved: Saved, mode: Mode): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, list] of Object.entries(saved.view)) {
    result[key] = list.filter((entry) => !VOLATILE.test(entry)).map((entry) => normaliseText(entry, mode))
  }
  return result
}

test('save: organization, contact and sales order with line items — the same request and the same saved record as v7', async ({ page }) => {
  const results: Record<string, Record<string, Saved>> = { Accounts: {}, Contacts: {}, SalesOrder: {} }
  for (const mode of MODES) {
    const account = await createThrough(page, 'Accounts', mode, async (form) => {
      await form.locator('form#EditView [name="accountname"]').fill(`${marker(mode)} Größe & Söhne «Ёлка»`)
      const website = form.locator('form#EditView [name="website"]')
      if ((await website.count()) > 0 && await website.isVisible()) {
        await website.fill('example.test')
      }
      const revenue = form.locator('form#EditView [name="annual_revenue"]')
      if ((await revenue.count()) > 0 && await revenue.isVisible()) {
        await revenue.fill('12345.5')
      }
    })
    results['Accounts'] = { ...results['Accounts'], [mode]: account }
    const contact = await createThrough(page, 'Contacts', mode, async (form) => {
      await form.locator('form#EditView [name="lastname"]').fill(`${marker(mode)} Schäfer-Иванова`)
      await form.locator('form#EditView [name="firstname"]').fill('Jörg')
      await pickInPopup(form, () => form.locator('form#EditView input[name="account_id"]').locator('xpath=ancestor::td[1]').locator('.relatedPopup').click(), 'accountname', marker(mode))
      await expect(form.locator('form#EditView input[name="account_id"]')).toHaveValue(account.id)
    })
    results['Contacts'] = { ...results['Contacts'], [mode]: contact }
    const order = await createThrough(page, 'SalesOrder', mode, async (form) => {
      await form.locator('form#EditView [name="subject"]').fill(`${marker(mode)} ! Bestellung Ä-ß`)
      const accountField = form.locator('form#EditView input[name="account_id"]')
      if ((await accountField.count()) > 0) {
        await pickInPopup(form, () => accountField.locator('xpath=ancestor::td[1]').locator('.relatedPopup').click(), 'accountname', marker(mode))
      }
      await buildLineItems(form)
    })
    results['SalesOrder'] = { ...results['SalesOrder'], [mode]: order }
  }
  for (const module of Object.keys(results)) {
    const off = results[module]?.['off']
    const on = results[module]?.['on']
    expect(off !== undefined && on !== undefined, module).toBe(true)
    if (off === undefined || on === undefined) {
      continue
    }
    // Ids differ between the two records: the record itself and the organization each one refers to (exact values only).
    const ids = new Map<string, string>([[off.id, 'ID'], [on.id, 'ID']])
    if (module === 'Contacts' || module === 'SalesOrder') {
      for (const account of [results['Accounts']?.['off'], results['Accounts']?.['on']]) {
        if (account !== undefined) {
          ids.set(account.id, 'ACCOUNT')
        }
      }
    }
    const unify = (pairs: [string, string][]): [string, string][] => pairs.map(([key, value]): [string, string] => [key, ids.get(value) ?? value])
    expect(unify(on.body), `${module}: request body`).toEqual(unify(off.body))
    const viewOn = comparable(on, 'on')
    const viewOff = comparable(off, 'off')
    const unifyView = (view: Record<string, string[]>): Record<string, string[]> => view
    expect(unifyView(viewOn), `${module}: saved record`).toEqual(unifyView(viewOff))
  }
  const items = results['SalesOrder']?.['on']?.view['items'] ?? []
  expect(items.some((row) => row.includes(ITEMS[0]?.name ?? '-')), 'line items saved').toBe(true)
})

test('documents of a record: the PDF of an extension (ITS4You PDFMaker, where active) is the same document as without the theme', async ({ page }) => {
  const orders = created.filter((record) => record.module === 'SalesOrder')
  expect(orders.length, 'synthetic orders of the save test').toBeGreaterThanOrEqual(2)
  const texts: Record<string, string> = {}
  for (const [index, mode] of MODES.entries()) {
    const order = orders[index]
    if (order === undefined) {
      continue
    }
    await openIn(page, `index.php?module=SalesOrder&view=Detail&record=${order.id}&mode=showDetailViewByMode&requestMode=full`, mode)
    const pdf = page.locator('#PDFMakerContentDiv')
    test.skip((await pdf.count()) === 0, 'PDFMaker is not active on this instance')
    // The number of the order differs between the two records: taken from the details tab and replaced in the text.
    const numberCell = page.locator('[id$="_detailView_fieldValue_salesorder_no"]').first()
    const number = (await numberCell.count()) > 0 ? (await numberCell.innerText()).trim() : ''
    await pdf.locator('.PDFMoreAction').click()
    const first = await page.locator('#use_common_template option').first().getAttribute('value') ?? ''
    await choose(page, '#use_common_template', [first])
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await pdf.locator('.PDFMakerDownloadPDF').click()
    const file = resolve(repoRoot, `.local/e2e-output/${target}/mu07-${mode}.pdf`)
    await (await download).saveAs(file)
    // pdftotext (poppler): the text of the document; the file holds data of the instance and is removed at once.
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
    rmSync(file)
    texts[mode] = normaliseText(text, mode).split(number === '' ? '\u0000' : number).join('NO').replace(/[ \t]+/g, ' ')
  }
  expect(texts['off']?.length ?? 0, 'text of the PDF').toBeGreaterThan(20)
  expect(texts['on']).toBe(texts['off'])
})

test('PDFMaker list integration: selected IDs, templates, language and the downloaded batch PDF match v7', async ({ page }) => {
  const orders = created.filter((record) => record.module === 'SalesOrder')
  expect(orders.length).toBeGreaterThanOrEqual(2)
  const results: unknown[] = []
  for (const mode of MODES) {
    await openIn(page, 'index.php?module=SalesOrder&view=List', mode)
    const native = page.locator('.listViewActionsContainer a[onclick*="PDFMaker_Actions_Js.getPDFListViewPopup2"]')
    test.skip(await native.count() === 0, 'PDFMaker is not installed on this instance')
    const all = await page.locator('.lists-menu a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('href')
    const search = encodeURIComponent(JSON.stringify([[['subject', 'c', MARK]]]))
    await openIn(page, `${all ?? 'index.php?module=SalesOrder&view=List'}&search_params=${search}`, mode)
    if (mode === 'on') await expect(page.locator('.mu-pdfmaker-export')).toBeHidden()
    for (const order of orders) await page.locator(`tr[data-id="${order.id}"] .listViewEntriesCheckBox`).check()
    const requests: [string, string][][] = []
    const listener = (request: Request): void => {
      const params = new URLSearchParams(`${new URL(request.url()).search.slice(1)}&${request.postData() ?? ''}`)
      if (params.get('module') === 'PDFMaker' && ['IndexAjax', 'CreatePDFFromTemplate'].includes(params.get('view') ?? params.get('action') ?? '')) {
        requests.push([...params].filter(([key]) => !['__vtrftk', '_'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
      }
    }
    page.on('request', listener)
    if (mode === 'on') {
      await expect(page.locator('.mu-pdfmaker-export')).toHaveCount(1)
      await page.setViewportSize({ width: 412, height: 900 })
      for (const selector of ['.mu-pdfmaker-export', '#PageJump', '.listViewMassActions > button']) {
        expect(await page.locator(selector).evaluate((element) => {
          const r = element.getBoundingClientRect()
          return r.x >= 0 && r.right <= innerWidth && element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
        }), selector).toBe(true)
      }
      await page.locator('.mu-pdfmaker-export').click()
    } else {
      await page.locator('.listViewMassActions > button').click()
      await native.click()
    }
    const modal = page.locator('.PDFMakerContainer:has(#exportSelectDFMakerForm)')
    await expect(modal).toBeVisible()
    const templates = await modal.locator('#use_common_template option').evaluateAll((options) => options.map((option) => ({ id: option.getAttribute('value'), label: option.textContent })))
    expect(templates.length).toBeGreaterThan(0)
    await choose(page, '#use_common_template', [])
    await expect(modal.locator('.PDFMakerDownloadPDF')).toBeDisabled()
    await choose(page, '#use_common_template', [templates[0]?.id ?? ''])
    await expect(modal.locator('.PDFMakerDownloadPDF')).toBeEnabled()
    if (mode === 'on') {
      await page.setViewportSize({ width: 412, height: 900 })
      const box = await modal.locator('.modal-content').boundingBox()
      expect(box?.x).toBeGreaterThanOrEqual(0)
      expect((box?.x ?? 0) + (box?.width ?? 999)).toBeLessThanOrEqual(412)
      await page.setViewportSize({ width: 1440, height: 900 })
    }
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await modal.locator('.PDFMakerDownloadPDF').click()
    const file = resolve(repoRoot, `.local/e2e-output/${target}/mu12-batch-${mode}.pdf`)
    await (await download).saveAs(file)
    let text = ''
    try { text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }) } finally { rmSync(file) }
    expect(text.length).toBeGreaterThan(20)
    page.off('request', listener)
    expect(requests).toHaveLength(2)
    results.push({ templates, requests, text })
  }
  expect(results[1]).toEqual(results[0])
})

test('field widgets: autocomplete of a reference, date picker and rich text editor work as in v7', async ({ page }) => {
  const runs: Record<string, unknown> = {}
  for (const mode of MODES) {
    // Autocomplete of a reference field (jQuery UI): the same suggestions, the choice fills the hidden id.
    await openIn(page, 'index.php?module=Contacts&view=Edit', mode)
    const display = page.locator('form#EditView input[name="account_id_display"]')
    await display.click()
    await display.pressSequentially(isClean ? 'Mül' : 'ООО', { delay: 60 })
    const menu = page.locator('ul.ui-autocomplete:visible').first()
    await expect(menu).toBeVisible()
    await settle(page)
    const suggestions = await menu.locator('li').allInnerTexts()
    await menu.locator('li').first().click()
    const chosen = await page.locator('form#EditView input[name="account_id"]').inputValue()
    // A bootbox question of v7 about the address of the organization.
    const confirm = page.locator('.bootbox.modal.in [data-bb-handler="cancel"]')
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click()
    }
    // Date picker of a date field: opens on a click, a day fills the field in the user's format.
    await openIn(page, 'index.php?module=Potentials&view=Edit', mode)
    const date = page.locator('form#EditView input.dateField:visible').first()
    await date.click()
    const picker = page.locator('.datepicker:visible, .ui-datepicker:visible').first()
    await expect(picker).toBeVisible()
    const pickerBox = await picker.boundingBox()
    await picker.locator('td.day:not(.old):not(.new), td[data-handler="selectDay"]').filter({ hasText: /^15$/ }).first().click()
    const picked = await date.inputValue()
    // Rich text: the CKEditor of a document note (or of the description where an instance has one).
    await openIn(page, 'index.php?module=Documents&view=Edit', mode)
    const editor = page.locator('.cke:visible, .cke_editable:visible').first()
    const hasEditor = (await editor.count()) > 0
    let typed = ''
    if (hasEditor) {
      const frame = page.locator('.cke iframe').first().contentFrame()
      await frame.locator('body').click()
      await frame.locator('body').pressSequentially('MU07 Größe Ёлка', { delay: 20 })
      typed = await page.evaluate(() => {
        const ck = (window as unknown as { CKEDITOR?: { instances: Record<string, { getData: () => string }> } }).CKEDITOR
        return Object.values(ck?.instances ?? {}).map((instance) => instance.getData()).join('|')
      })
    }
    runs[mode] = { suggestions, chosen, picked, pickerShown: pickerBox !== null, hasEditor, typed }
  }
  expect(runs['on']).toEqual(runs['off'])
  expect((runs['on'] as { chosen: string }).chosen).not.toBe('')
  expect((runs['on'] as { picked: string }).picked).toMatch(/15/)
})

test('save once: Enter in a field sends nothing, a double click on Save sends one request — as v7', async ({ page }) => {
  for (const mode of MODES) {
    await openIn(page, 'index.php?module=Accounts&view=Edit', mode)
    await page.locator('form#EditView [name="accountname"]').fill(`${marker(mode)} once`)
    expect(await fillMandatory(page, mode)).toEqual([])
    const saves: string[] = []
    page.on('request', (request) => {
      if (isSave('Accounts')(request)) {
        saves.push(request.url())
      }
    })
    await page.locator('form#EditView [name="accountname"]').press('Enter')
    await page.waitForTimeout(800)
    expect(saves, `${mode}: Enter`).toHaveLength(0)
    expect(page.url(), `${mode}: Enter keeps the form`).toContain('view=Edit')
    const button = page.locator('form#EditView button[type="submit"]:visible').last()
    await Promise.all([page.waitForURL(/view=Detail&record=\d+/, { timeout: 60_000 }), button.dblclick()])
    await settle(page)
    expect(saves, `${mode}: double click`).toHaveLength(1)
    created.push({ module: 'Accounts', id: new URL(page.url()).searchParams.get('record') ?? '' })
    page.removeAllListeners('request')
  }
})

test('validation: empty mandatory field and wrong formats are shown, nothing is sent, typed values stay', async ({ page }) => {
  const runs: Record<string, unknown> = {}
  for (const mode of MODES) {
    await openIn(page, 'index.php?module=Potentials&view=Edit', mode)
    const form = page.locator('form#EditView')
    const typed = `${marker(mode)} Größe`
    const description = form.locator('[name="description"]')
    if ((await description.count()) > 0) {
      await description.fill(typed)
    }
    const date = form.locator('input.dateField:visible').first()
    await date.fill('31-31-31x')
    const amount = form.locator('[name="amount"]')
    if ((await amount.count()) > 0) {
      await amount.fill('12abc')
    }
    let sent = 0
    page.on('request', (request) => {
      if (isSave('Potentials')(request)) {
        sent++
      }
    })
    await form.locator('button[type="submit"]:visible').last().click()
    await page.waitForTimeout(800)
    const errors = await form.locator('.input-error').evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).name || element.id).sort())
    // The message of the validator of v7 (qtip next to the first field in error) is shown and readable.
    const message = page.locator('.qtip:visible, .formError:visible, .help-block.error:visible').first()
    await expect(message, mode).toBeVisible()
    const contrast = await message.evaluate((element) => {
      const style = getComputedStyle(element.querySelector('.qtip-content') ?? element)
      return { color: style.color, opacity: style.opacity, size: element.getBoundingClientRect().width }
    })
    expect(contrast.opacity, mode).not.toBe('0')
    expect(sent, mode).toBe(0)
    expect(page.url(), mode).toContain('view=Edit')
    runs[mode] = { errors, description: (await description.count()) > 0 ? await description.inputValue() : null, date: await date.inputValue() }
    page.removeAllListeners('request')
  }
  expect(normaliseText(JSON.stringify(runs['on']), 'on')).toBe(normaliseText(JSON.stringify(runs['off']), 'off'))
  expect((runs['on'] as { errors: string[] }).errors.length).toBeGreaterThan(0)
})

/**
 * A text field of the record view with the inline edit of v7 (its input is rendered when the pencil is clicked; the cell
 * keeps the name and the type in .fieldBasicData): a string field that is not a name or number, else a text area.
 */
async function inlineField(page: Page): Promise<string> {
  const name = await page.locator('td.fieldValue:has(.editAction) .fieldBasicData').evaluateAll((elements) => {
    const fields = elements.map((element) => ({ name: element.getAttribute('data-name') ?? '', type: element.getAttribute('data-type') ?? '' }))
      .filter((field) => !/name$|_no$|^inn$|^subject$|^cf_/.test(field.name))
    return (fields.find((field) => field.type === 'string') ?? fields.find((field) => field.type === 'text'))?.name ?? ''
  })
  expect(name, 'a text field with inline edit').not.toBe('')
  return name
}

/** Saves an open inline edit the way the user does: Enter in a single-line input, the tick of v7 for a text area. */
async function submitInline(page: Page, field: string, timeout?: number): Promise<void> {
  const options = timeout === undefined ? {} : { timeout }
  const input = page.locator(`td.fieldValue .edit [name="${field}"]`).first()
  if (await input.evaluate((element) => element instanceof HTMLTextAreaElement, undefined, options)) {
    await page.locator(`td.fieldValue:has(.fieldBasicData[data-name="${field}"]) .inlineAjaxSave`).first().click(options)
  } else {
    await input.press('Enter', options)
  }
}

async function startInlineEdit(page: Page, field: string): Promise<void> {
  const cell = page.locator(`td.fieldValue:has(.fieldBasicData[data-name="${field}"])`).first()
  await cell.hover()
  await cell.locator('.editAction').click()
  await expect(cell.locator(`.edit [name="${field}"]`)).toBeVisible()
}

test('inline edit: saves through the events of v7; a refusal and an expired session are visible and keep the record', async ({ page, browser }) => {
  const account = created.find((record) => record.module === 'Accounts')
  expect(account, 'synthetic organization of the save test').toBeDefined()
  const id = account?.id ?? ''
  // The details tab: every field of the record has the inline edit of v7 there.
  const url = `index.php?module=Accounts&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full`
  const runs: Record<string, unknown> = {}
  for (const mode of MODES) {
    await openIn(page, url, mode)
    const field = await inlineField(page)
    await page.evaluate(() => {
      const win = window as unknown as { muEvents: string[]; app: { event: { on: (name: string, handler: () => void) => void } } }
      win.muEvents = []
      for (const name of ['PreAjaxSaveEvent', 'PostAjaxSaveEvent', 'post.save.failed']) {
        win.app.event.on(name, () => { win.muEvents.push(name) })
      }
    })
    // 1. A normal save (Enter: Detail.js clicks its tick).
    await startInlineEdit(page, field)
    const value = `${marker(mode)} inline Ä`
    await page.locator(`td.fieldValue .edit [name="${field}"]`).first().fill(value)
    const saved = page.waitForResponse((response) => response.request().method() === 'POST' && (response.request().postData() ?? '').includes('action=SaveAjax'))
    await submitInline(page, field)
    expect((await saved).status()).toBe(200)
    await settle(page)
    const events = await page.evaluate(() => (window as unknown as { muEvents: string[] }).muEvents)
    // 2. The server refuses the save: the message of v7 is shown, the record keeps the saved value.
    await page.route('**/index.php', async (route) => {
      if ((route.request().postData() ?? '').includes('action=SaveAjax')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'MU07', message: 'MU07 refused by the server' } }) })
        return
      }
      await route.fallback()
    })
    await startInlineEdit(page, field)
    await page.locator(`td.fieldValue .edit [name="${field}"]`).first().fill(`${value} refused`)
    await submitInline(page, field)
    const notice = page.locator('.vt-notification, [data-notify="container"]').filter({ hasText: 'MU07 refused' }).first()
    await expect(notice, `${mode}: refusal shown`).toBeVisible()
    const afterRefusal = await page.locator(`td.fieldValue .edit [name="${field}"]`).first().inputValue()
    // The user gives up the change (an inline edit left open is saved by v7 when the page is left).
    await page.locator(`td.fieldValue:has(.fieldBasicData[data-name="${field}"]) .inlineAjaxCancel`).first().click()
    await expect(page.locator(`td.fieldValue .edit [name="${field}"]`).first()).toBeHidden()
    await page.unroute('**/index.php')
    // 3. The session has expired: a session of its own is signed out in another tab, then the inline save is sent.
    const own = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } })
    const ownPage = await own.newPage()
    await prepare(own, ownPage)
    await signIn(ownPage, adminCredentials())
    await openIn(ownPage, url, mode)
    await startInlineEdit(ownPage, field)
    await ownPage.locator(`td.fieldValue .edit [name="${field}"]`).first().fill(`${value} expired`)
    const other = await own.newPage()
    await other.goto('index.php?module=Users&action=Logout')
    await other.close()
    // Background requests of an instance may notice the lost session first and take the page to the sign-in form.
    const expired = ownPage.waitForResponse((response) => response.request().method() === 'POST' && (response.request().postData() ?? '').includes('action=SaveAjax'), { timeout: 15_000 }).catch(() => null)
    await submitInline(ownPage, field, 10_000).catch(() => undefined)
    const answer = await expired
    await ownPage.waitForTimeout(1500)
    const expiredState = {
      status: answer?.status() ?? null,
      json: (answer?.headers()['content-type'] ?? '').includes('json'),
      blank: await ownPage.evaluate(() => document.body.innerText.trim() === ''),
      view: new URL(ownPage.url()).searchParams.get('view'),
      login: await ownPage.locator('#username, form[action*="Login"]').count() > 0,
    }
    await own.close()
    await openIn(page, url, mode)
    const stored = await page.locator(`[id$="_detailView_fieldValue_${field}"]`).first().textContent()
    runs[mode] = { events, afterRefusal: normaliseText(afterRefusal, mode), expiredState, stored: normaliseText((stored ?? '').replace(/\s+/g, ' ').trim(), mode) }
  }
  expect(runs['on']).toEqual(runs['off'])
  expect((runs['on'] as { events: string[] }).events).toEqual(expect.arrayContaining(['PreAjaxSaveEvent', 'PostAjaxSaveEvent']))
  expect((runs['on'] as { stored: string }).stored).toContain(`${MARK}-MODE inline Ä`)
})

test('cancel: changed values of the edit form are not saved', async ({ page }) => {
  const account = created.find((record) => record.module === 'Accounts')
  const id = account?.id ?? ''
  for (const mode of MODES) {
    await openIn(page, `index.php?module=Accounts&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full`, mode)
    const before = await recordState(page)
    await openIn(page, `index.php?module=Accounts&view=Edit&record=${id}`, mode)
    await page.locator('form#EditView [name="accountname"]').fill(`${marker(mode)} cancelled`)
    let sent = 0
    page.on('request', (request) => {
      if (isSave('Accounts')(request)) {
        sent++
      }
    })
    await Promise.all([page.waitForURL((current) => !current.search.includes('view=Edit'), { timeout: 30_000 }), page.locator('form#EditView .cancelLink:visible, form#EditView a:has-text("Cancel"):visible, form#EditView a:has-text("Отменить"):visible').first().click()])
    page.removeAllListeners('request')
    expect(sent, mode).toBe(0)
    await openIn(page, `index.php?module=Accounts&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full`, mode)
    expect((await recordState(page))['fields'], mode).toEqual(before['fields'])
  }
})

test('languages: RU, EN and DE of the theme change neither the forms nor what they send, nor the formats of the CRM', async ({ page }) => {
  const order = created.find((record) => record.module === 'SalesOrder')
  const states: Record<string, unknown> = {}
  for (const locale of ['de-DE', 'ru-RU', 'en-US']) {
    await openIn(page, 'index.php?module=Home&view=DashBoard', 'on')
    expect((await savePersonal(page, { locale })).ok).toBe(true)
    await openIn(page, 'index.php?module=Accounts&view=Edit', 'on')
    const form = { controls: await formState(page), data: await formData(page) }
    let view: Record<string, string[]> | null = null
    if (order !== undefined) {
      await openIn(page, `index.php?module=SalesOrder&view=Detail&record=${order.id}&mode=showDetailViewByMode&requestMode=full`, 'on')
      view = await recordState(page)
    }
    const system = await page.locator('[data-mu-root="system-menu"] button').first().getAttribute('aria-label')
    states[locale] = { form, view, system }
  }
  const strip = (value: unknown): unknown => ({ ...(value as Record<string, unknown>), system: null })
  expect(strip(states['de-DE'])).toEqual(strip(states['en-US']))
  expect(strip(states['ru-RU'])).toEqual(strip(states['en-US']))
  const labels = new Set(Object.values(states).map((value) => (value as { system: string | null }).system))
  expect(labels.size, 'texts of the theme follow the language').toBe(3)
  await clearPersonal(page)
})

test('narrow screens: record view and edit form without page scroll and with reachable Save, as v7', async ({ page }) => {
  const account = created.find((record) => record.module === 'Accounts')
  const id = account?.id ?? ''
  for (const width of [1024, 768, 412]) {
    await page.setViewportSize({ width, height: 860 })
    for (const url of [`index.php?module=Accounts&view=Detail&record=${id}`, `index.php?module=SalesOrder&view=Edit`]) {
      const result: Record<string, boolean> = {}
      for (const mode of MODES) {
        await openIn(page, url, mode)
        result[mode] = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      }
      expect((result['on'] ?? false) || !(result['off'] ?? false), `${url} at ${String(width)}: no page scroll added by the theme`).toBe(true)
      if (url.includes('view=Edit')) {
        await expect(page.locator('form#EditView button[type="submit"]:visible').last()).toBeInViewport()
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('rights of a restricted user (clean stand): hidden and read-only fields, records of others refused, as v7', async ({ browser }) => {
  test.skip(!isClean, 'the restricted user exists on the clean stand only')
  const foreignId = await adminAccount(browser)
  // A context of its own without the administrator's session (the project's storage state would apply otherwise).
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await prepare(context, page)
  await signIn(page, cleanUserCredentials('limited'))
  await page.goto('index.php?module=Accounts&view=List')
  const ownId = await page.locator('tr.listViewEntries', { hasText: 'Müller & Söhne GmbH' }).first().getAttribute('data-id') ?? ''
  expect(ownId).not.toBe('')
  const states: Record<string, unknown> = {}
  for (const mode of MODES) {
    await openIn(page, `index.php?module=Accounts&view=Edit&record=${ownId}`, mode)
    const controls = await formState(page)
    expect(controls.some((field) => field.name === 'annual_revenue'), `${mode}: hidden field`).toBe(false)
    await openIn(page, `index.php?module=Accounts&view=Detail&record=${ownId}&mode=showDetailViewByMode&requestMode=full`, mode)
    const view = await recordState(page)
    // An organization of the administrator (not shared with U): refused by Vtiger with the theme as without it.
    const refused = await page.goto(`index.php?module=Accounts&view=Edit&record=${foreignId}&modernui=${mode}`)
    const denied = await page.locator('body').innerText()
    states[mode] = { controls, view, refused: refused?.status() ?? 0, denied: /Permission denied|Доступ запрещ|Zugriff verweigert|not permitted/i.test(denied) }
  }
  expect(states['on']).toEqual(states['off'])
  const on = states['on'] as { controls: { name: string; readonly: boolean; disabled: boolean }[]; denied: boolean; view: Record<string, string[]> }
  const phone = on.controls.find((field) => field.name === 'phone')
  expect(phone === undefined || phone.readonly || phone.disabled, 'read-only phone of U').toBe(true)
  expect(on.view['editable']?.some((cell) => cell.endsWith('_phone')) ?? false, 'no inline edit of the read-only phone').toBe(false)
  expect(on.denied, 'record of another user refused').toBe(true)
  await context.close()
})

test('rights of a view-only user (clean stand): a record of another user is shown read-only and its edit form is refused, as v7', async ({ browser }) => {
  test.skip(!isClean, 'the view-all user exists on the clean stand only')
  const foreignId = await adminAccount(browser)
  // G gets the theme through the pilot of its role for this test (the HTML form of the settings page), removed at the end.
  const admin = await adminPage(browser)
  await admin.goto(SETTINGS_FORMS)
  const role = (await admin.locator('select#modernui-pilot-role option').filter({ hasText: /^MU Viewer$/ }).getAttribute('value')) ?? ''
  expect(role).not.toBe('')
  const added = (await admin.locator(`tr[data-mu-pilot-role="${role}"]`).count()) === 0
  if (added) {
    const form = admin.locator('form:has(button[name="modernui-pilot-add-role"])')
    await form.locator('select[name="role"]').selectOption(role)
    await Promise.all([admin.waitForURL(/result=/), form.locator('button[name="modernui-pilot-add-role"]').click()])
  }
  const context = await browser.newContext({ baseURL: crmUrl(), viewport: { width: 1440, height: 900 }, storageState: { cookies: [], origins: [] } })
  const page = await context.newPage()
  await prepare(context, page)
  await signIn(page, cleanUserCredentials('viewer'))
  const states: Record<string, unknown> = {}
  try {
    for (const mode of MODES) {
      await openIn(page, `index.php?module=Accounts&view=Detail&record=${foreignId}&mode=showDetailViewByMode&requestMode=full`, mode)
      const view = await recordState(page)
      const refused = await page.goto(`index.php?module=Accounts&view=Edit&record=${foreignId}&modernui=${mode}`)
      const text = await page.locator('body').innerText()
      states[mode] = { view, refused: refused?.status() ?? 0, denied: /Permission denied|Доступ запрещ|Zugriff verweigert|not permitted/i.test(text) }
    }
  } finally {
    if (added) {
      await admin.goto(SETTINGS_FORMS)
      await Promise.all([admin.waitForURL(/result=/), admin.locator(`tr[data-mu-pilot-role="${role}"] button[name="modernui-pilot-remove-role"]`).click()])
    }
    await admin.context().close()
  }
  expect(states['on']).toEqual(states['off'])
  const on = states['on'] as { view: Record<string, string[]>; denied: boolean }
  expect(on.view['fields']?.length ?? 0, 'the record is shown').toBeGreaterThan(0)
  expect(on.denied, 'its edit form is refused').toBe(true)
  await context.close()
})

/** An organization of the administrator that U may not see (seed of the clean stand). */
async function adminAccount(browser: Browser): Promise<string> {
  const page = await adminPage(browser)
  await page.goto('index.php?module=Accounts&view=List&modernui=on')
  const id = await page.locator('tr.listViewEntries', { hasText: 'Weißbier Großhandel AG' }).first().getAttribute('data-id') ?? ''
  await page.context().close()
  expect(id).not.toBe('')
  return id
}

test('documents and comments (clean stand): upload a file and add a comment through the forms of v7, as without the theme', async ({ page }) => {
  test.skip(!isClean, 'files and comments are written on the clean stand only')
  // Each mode comments its own organization of the save test: v7 posts the FormData of the whole comment form, which
  // also carries the edit blocks of the comments already there.
  const accounts = created.filter((record) => record.module === 'Accounts')
  const results: Record<string, unknown> = {}
  for (const [index, mode] of MODES.entries()) {
    const account = accounts[index]
    await openIn(page, 'index.php?module=Documents&view=Edit', mode)
    await page.locator('form#EditView [name="notes_title"]').fill(`${marker(mode)} Dokument Ä`)
    await page.locator('form#EditView input[type="file"][name="filename"]').setInputFiles({ name: 'mu07-größe.txt', mimeType: 'text/plain', buffer: Buffer.from('MU07 Größenänderungsübersicht — Съешь же ещё\n') })
    expect(await fillMandatory(page, mode)).toEqual([])
    const request = page.waitForRequest(isSave('Documents'))
    await Promise.all([page.waitForURL(/view=Detail&record=\d+/, { timeout: 60_000 }), page.locator('form#EditView button[type="submit"]:visible').last().click()])
    const body = normalise(payload(await request), mode)
    const id = new URL(page.url()).searchParams.get('record') ?? ''
    created.push({ module: 'Documents', id })
    await settle(page)
    const download = page.locator('a[href*="action=DownloadFile"]').first()
    const href = (await download.getAttribute('href')) ?? ''
    const file = await page.request.get(href)
    const comment = `${marker(mode)} Kommentar Ä`
    let commentBody: [string, string][] = []
    if (account !== undefined) {
      await openIn(page, `index.php?module=Accounts&view=Detail&record=${account.id}`, mode)
      const box = page.locator('textarea.commentcontent:visible').first()
      await box.fill(comment)
      const posted = page.waitForRequest((candidate) => candidate.method() === 'POST' && (candidate.postData() ?? '').includes('ModComments'))
      await page.locator('.detailViewSaveComment[data-mode="add"]:visible').first().click()
      commentBody = normalise(payload(await posted), mode).filter(([key]) => !['related_to', 'parent_id', 'record'].includes(key))
      await expect(page.locator('.commentsList, .commentContainer').filter({ hasText: comment }).first()).toBeVisible()
    }
    results[mode] = { body: body.map(([key, value]) => [key, value.split(id).join('ID')]), file: file.status(), bytes: (await file.body()).length, commentBody }
  }
  expect(results['on']).toEqual(results['off'])
})
