/**
 * Helpers of the stage 07 scenarios (records.spec.ts): snapshots of what v7 shows and sends — record views, edit
 * forms, line items, the body of a save request — taken the same way with the theme off (safe mode of the session)
 * and on, so the scenarios compare v7 with v7 under the theme instead of the theme with itself. Synthetic records get
 * a marker in their name and are the only ones the scenarios delete.
 */
import { expect, type Page, type Request } from '@playwright/test'
import { SKIN, waitForShell } from './support'

export type Mode = 'off' | 'on'
export const MODES: readonly Mode[] = ['off', 'on']

/**
 * Marker of the synthetic records of a run in one mode: MU07-off-<run> …, MU07-on-<run> … (normalised for comparisons).
 * The run id keeps names unique: Vtiger 8.4 refuses a second organization with the same name (duplicate prevention).
 */
export const MARK = 'MU07'
const RUN = Date.now().toString(36)
export const marker = (mode: Mode): string => `${MARK}-${mode}-${RUN}`

export function withMode(url: string, mode: Mode): string {
  return `${url}${url.includes('?') ? '&' : '?'}modernui=${mode}`
}

/** Opens a CRM page with the theme off (safe mode of the session) or on, and waits until it has settled. */
export async function openIn(page: Page, url: string, mode: Mode): Promise<void> {
  await page.goto(withMode(url, mode))
  if (mode === 'on') {
    await waitForShell(page)
    await expect(page.locator('html')).toHaveClass(/mu-shell-ready/)
  } else {
    await expect(page.locator(SKIN)).toHaveCount(0)
  }
  await settle(page)
}

/** Until the requests of the page (extensions load buttons and blocks after ready) are done. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(300)
}

export interface FieldState {
  name: string
  tag: string
  type: string
  id: string
  value: string
  /** The cell of the field is shown (null for hidden inputs). */
  cell: boolean | null
  /** The control itself (or its Select2 box) is shown. */
  self: boolean | null
  required: boolean
  disabled: boolean
  readonly: boolean
  label: string
}

/**
 * Every named control of a form in DOM order: value, whether its cell and the control are shown, mandatory,
 * disabled, read-only, the label of v7. Times and the CSRF token are normalised (they change between two loads).
 */
export async function formState(page: Page, selector = 'form#EditView'): Promise<FieldState[]> {
  return page.locator(selector).first().evaluate((form: HTMLFormElement) => {
    const shown = (element: Element | null | undefined): boolean => element != null
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
    const time = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?$/i
    const result: FieldState[] = []
    for (const element of Array.from(form.elements)) {
      const control = element as HTMLInputElement
      if (typeof control.name !== 'string' || control.name === '') {
        continue
      }
      let value: string
      if (control.type === 'checkbox' || control.type === 'radio') {
        value = control.checked ? `on:${control.value}` : 'off'
      } else if (element instanceof HTMLSelectElement) {
        value = Array.from(element.selectedOptions).map((option) => option.value).join('|')
      } else if (control.name === '__vtrftk') {
        value = 'TOKEN'
      } else {
        value = control.value
      }
      if (time.test(value)) {
        value = 'TIME'
      }
      const cell = control.closest('td')
      const labelCell = cell?.previousElementSibling
      const select2 = control.previousElementSibling?.classList.contains('select2-container') === true ? control.previousElementSibling : null
      result.push({
        name: control.name,
        tag: control.tagName,
        type: control.type,
        id: control.id,
        value,
        cell: control.type === 'hidden' ? null : shown(cell ?? control),
        self: control.type === 'hidden' ? null : shown(select2 ?? control),
        required: control.getAttribute('data-rule-required') === 'true' || control.required,
        disabled: control.disabled,
        readonly: control.readOnly,
        label: labelCell?.classList.contains('fieldLabel') === true ? labelCell.textContent.replace(/\s+/g, ' ').trim() : '',
      })
    }
    return result
  })
}

/** What a native submit of the form would send, in order (FormData), with the token and times normalised. */
export async function formData(page: Page, selector = 'form#EditView'): Promise<[string, string][]> {
  return page.locator(selector).first().evaluate((form: HTMLFormElement) => {
    const time = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?$/i
    return Array.from(new FormData(form).entries()).map(([name, value]): [string, string] => {
      if (typeof value !== 'string') {
        return [name, `file:${value.name}:${String(value.size)}`]
      }
      return [name, name === '__vtrftk' ? 'TOKEN' : time.test(value) ? 'TIME' : value]
    })
  })
}

/** The body of a POST (urlencoded or multipart) as ordered pairs; file parts as file:<name>:<size>. */
export function payload(request: Request): [string, string][] {
  const type = request.headers()['content-type'] ?? ''
  const buffer = request.postDataBuffer()
  if (buffer === null) {
    return []
  }
  if (!type.includes('multipart/form-data')) {
    return Array.from(new URLSearchParams(buffer.toString('utf8')).entries())
  }
  const match = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type)
  const boundary = match?.[1] ?? match?.[2] ?? ''
  const text = buffer.toString('latin1')
  return text.split(`--${boundary}`).slice(1, -1).map((part): [string, string] => {
    const cut = part.indexOf('\r\n\r\n')
    const head = part.slice(0, cut)
    const body = part.slice(cut + 4).replace(/\r\n$/, '')
    const name = Buffer.from(/name="([^"]*)"/.exec(head)?.[1] ?? '', 'latin1').toString('utf8')
    const file = /filename="([^"]*)"/.exec(head)
    return [name, file === null ? Buffer.from(body, 'latin1').toString('utf8') : `file:${Buffer.from(file[1] ?? '', 'latin1').toString('utf8')}:${String(body.length)}`]
  })
}

/** Pairs of one mode made comparable with the other: token, times and the marker of the mode. */
export function normalise(pairs: [string, string][], mode: Mode): [string, string][] {
  const time = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?$/i
  return pairs.map(([name, value]): [string, string] => [
    name,
    name === '__vtrftk' ? 'TOKEN' : time.test(value) ? 'TIME' : value.split(marker(mode)).join(`${MARK}-MODE`),
  ])
}

export function normaliseText(value: string, mode: Mode): string {
  return value.split(marker(mode)).join(`${MARK}-MODE`)
}

/**
 * The record view as v7 draws it: buttons of the header in order, related tabs, blocks and widgets, values of the
 * fields (with their visibility), line items of inventory records.
 */
export async function recordState(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(() => {
    const shown = (element: Element | null): boolean => element !== null && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
    const text = (element: Element | null): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const all = (selector: string): Element[] => Array.from(document.querySelectorAll(selector))
    return {
      // Stage 13 puts native actions/tabs in accessible overflow menus. Compare their native contract separately
      // from presentation visibility (cloud-records tests open those menus and hit-test every available action).
      header: all('.detailview-header button, .detailview-header a.btn, .detailview-header .btn-group > a')
        .filter((element) => element.closest('[data-mu-root]') === null && !element.classList.contains('mu-record-back'))
        .map((element) => text(element) || (element.getAttribute('title') ?? '')),
      tabs: all('.related-tabs li[data-label-key], .related-tabs li[data-url]')
        .map((element) => `${element.getAttribute('data-label-key') ?? ''}|${element.getAttribute('data-module') ?? ''}|${String(element.closest('.hide, [hidden]') === null)}`),
      blocks: all('.detailview-content .block, .summaryView, .summaryWidgetContainer, .widgetContainer_comments').filter(shown)
        .map((element) => text(element.querySelector('h4, .blockHeader, .widget_header'))),
      widgets: all('.widget_header').filter(shown).map((element) => text(element.querySelector('h4, h3')) || text(element)),
      fields: all('[id*="_detailView_fieldValue_"], .summaryViewEntries td.fieldValue')
        .map((element) => `${element.id}|${text(element.querySelector('.value') ?? element)}|${String(shown(element))}`),
      editable: all('.editAction, .fieldValue .action .fa-pencil').filter(shown).map((element) => element.closest('td')?.id ?? ''),
      items: all('.lineItemsTable tr, #lineItemTab tr').map((row) => text(row)),
    }
  })
}

/** Line items and totals of an inventory edit form, as the form computed them. */
export async function lineItems(page: Page): Promise<{ rows: string[][]; totals: Record<string, string> }> {
  return page.evaluate(() => {
    const value = (element: Element | null): string => {
      if (element === null) {
        return ''
      }
      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        return element.value
      }
      return element.textContent.replace(/\s+/g, ' ').trim()
    }
    const rows = Array.from(document.querySelectorAll('#lineItemTab tr.lineItemRow:not(#row0):not(.lineItemCloneCopy)')).map((row) => [
      value(row.querySelector('.productName')), value(row.querySelector('.lineItemType')), value(row.querySelector('.qty')),
      value(row.querySelector('.listPrice')), value(row.querySelector('.productTotal')), value(row.querySelector('.discountTotal')),
      value(row.querySelector('.totalAfterDiscount')), value(row.querySelector('.netPrice')), value(row.querySelector('.rowNumber')),
    ])
    const totals: Record<string, string> = {}
    // Ids of the totals table; the popovers of v7 get random ids (popover123456) and hold inputs that FormData reports.
    for (const element of Array.from(document.querySelectorAll('#lineItemResult [id], #taxtype, #currency_id, #region_id'))) {
      if (element.id !== '' && !/^popover\d+$/.test(element.id) && element.closest('.popover') === null) {
        totals[element.id] = value(element)
      }
    }
    return { rows, totals }
  })
}

/** Sets a select the way a user change reaches v7 and its extensions (jQuery change, Select2 follows). */
export async function choose(page: Page, selector: string, values: string[]): Promise<void> {
  await page.locator(selector).first().evaluate((element: HTMLSelectElement, wanted: string[]) => {
    for (const option of Array.from(element.options)) {
      option.selected = wanted.includes(option.value)
    }
    const jq = (window as unknown as { jQuery?: (target: Element) => { trigger: (event: string) => void } }).jQuery
    if (jq === undefined) {
      element.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      jq(element).trigger('change')
    }
  }, values)
}

/** The save POST of a form: index.php with action=Save of the module (urlencoded or multipart). */
export function isSave(module: string, action = 'Save'): (request: Request) => boolean {
  return (request) => {
    if (request.method() !== 'POST' || !request.url().includes('index.php')) {
      return false
    }
    const pairs = payload(request)
    const get = (name: string): string | undefined => pairs.find(([key]) => key === name)?.[1]
    return get('action') === action && get('module') === module
  }
}

/** The CSRF token of the page (csrf-magic), for the delete action of the synthetic records. */
export async function token(page: Page): Promise<string> {
  return page.evaluate(() => {
    const value = (window as unknown as { csrfMagicToken?: unknown }).csrfMagicToken
    return typeof value === 'string' ? value : ''
  })
}

/**
 * Deletes a synthetic record through the standard delete action (DeleteAjax), only when its record view shows the
 * marker of the scenarios.
 */
export async function deleteSynthetic(page: Page, module: string, record: string, mark: string = MARK): Promise<void> {
  await page.goto(`index.php?module=${module}&view=Detail&record=${record}`)
  const label = await page.locator('.detailview-header').first().textContent().catch(() => '')
  if (!(label?.includes(mark) ?? false)) {
    throw new Error(`${module} ${record} is not a synthetic record of the scenarios — not deleted`)
  }
  const response = await page.request.post('index.php', {
    form: { module, action: 'DeleteAjax', record, __vtrftk: await token(page) },
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: page.url() },
  })
  expect(response.status(), `${module} ${record}`).toBe(200)
  expect(((await response.json()) as { success?: boolean }).success, `${module} ${record}`).toBe(true)
}

/** Date of today in the date format of the user (data-date-format of the field). */
export async function today(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((input: HTMLInputElement) => {
    const format = input.getAttribute('data-date-format') ?? 'yyyy-mm-dd'
    const now = new Date()
    const parts: Record<string, string> = {
      yyyy: String(now.getFullYear()), mm: String(now.getMonth() + 1).padStart(2, '0'), dd: String(now.getDate()).padStart(2, '0'),
    }
    return format.replace(/yyyy|mm|dd/g, (part) => parts[part] ?? part)
  })
}

/**
 * Fills the mandatory controls the scenario did not fill (an instance may require more than the core does): text with
 * the marker, numbers 1, dates today, pick-lists their first value. Reference fields must be filled by the scenario.
 * @returns names of mandatory controls left empty (references)
 */
export async function fillMandatory(page: Page, mode: Mode, selector = 'form#EditView'): Promise<string[]> {
  const form = page.locator(selector).first()
  const names = await form.evaluate((element: HTMLFormElement) => Array.from(element.querySelectorAll<HTMLInputElement>('[data-rule-required="true"]'))
    .filter((control) => control.name !== '' && control.value === '' && !control.disabled && control.closest('tr.lineItemCloneCopy, #row0') === null
      && control.getClientRects().length + (control.previousElementSibling?.getClientRects().length ?? 0) > 0)
    .map((control) => control.name))
  const left: string[] = []
  for (const name of names) {
    const control = form.locator(`[name="${name}"]`).first()
    const kind = await control.evaluate((element: HTMLInputElement) => element instanceof HTMLSelectElement ? 'select'
      : element.classList.contains('dateField') ? 'date' : element.classList.contains('autoComplete') || element.closest('.referencefield-wrapper') !== null ? 'reference'
        : element.getAttribute('data-rule-currency') === 'true' || element.getAttribute('data-rule-positive') === 'true' || /number|integer/i.test(element.getAttribute('data-fieldtype') ?? '') ? 'number' : 'text')
    if (kind === 'select') {
      const first = await control.evaluate((element: HTMLSelectElement) => Array.from(element.options).find((option) => option.value !== '')?.value ?? '')
      await choose(page, `${selector} [name="${name}"]`, [first])
    } else if (kind === 'date') {
      await control.fill(await today(page, `${selector} [name="${name}"]`))
    } else if (kind === 'number') {
      await control.fill('1')
    } else if (kind === 'text') {
      await control.fill(`${marker(mode)} ${name}`)
    } else {
      left.push(name)
    }
  }
  return left
}

/** Chooses a record in the popup of a field or a line item: search by name, then the first row. */
export async function pickInPopup(page: Page, opener: () => Promise<void>, searchName: string, searchValue: string): Promise<void> {
  await opener()
  const popup = page.locator('.modal.in .popupModal, .modal.in #popupPageContainer, .modal.in .popupEntriesDiv').first()
  await expect(popup).toBeVisible()
  const search = page.locator(`#popupModal.in .searchRow [name="${searchName}"]`).first()
  if ((await search.count()) > 0) {
    await search.fill(searchValue)
    const done = page.waitForResponse((response) => response.url().includes('index.php') && response.request().method() === 'POST' || response.url().includes('view=Popup'))
    await page.locator('#popupModal.in .searchRow [data-trigger="PopupListSearch"], #popupModal.in .searchRow button').first().click()
    await done
    await settle(page)
  }
  const row = page.locator('#popupModal.in .listViewEntries').filter({ hasText: searchValue }).first()
  await expect(row).toBeVisible()
  // The cell with the name: other cells of a popup row may hold links (an e-mail address opens the mail composer of v7).
  await row.locator('td').filter({ hasText: searchValue }).first().click()
  await expect(page.locator('.modal.in .popupModal, .modal.in #popupPageContainer')).toHaveCount(0)
  await settle(page)
  // v7 may ask what to do with the selection (copy the address of the organization: a bootbox confirm).
  const confirm = page.locator('.bootbox.modal.in [data-bb-handler="confirm"]')
  if ((await confirm.count()) > 0) {
    await confirm.first().click()
    await expect(page.locator('.bootbox.modal.in')).toHaveCount(0)
    await settle(page)
  }
}
