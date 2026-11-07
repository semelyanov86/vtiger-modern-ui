/**
 * Visual foundation of ModernUI (stage 10, docs/design.md §13.4–13.5): tokens, fonts and the states of the shared components
 * measured on real screens of the CRM — the list, a record, the edit form, quick create, notifications and the ModernUI
 * settings editor — against the values of the cloud reference (foundation-reference.ts), on both stands.
 *
 * - tokens: the stylesheet and Bootstrap of the server equal the preview of the editor (tokensFor) for the defaults and for
 *   changed settings; resetting the font of the common settings returns to the new base (the cloud font);
 * - fonts: the cloud font Poppins 400/600 and the pinned Cyrillic face, files from the CRM only, RU/EN/DE texts;
 * - components: normal / hover / active / focus / disabled / error / loading / empty states of the v7 elements outside the
 *   Vue islands and of the islands themselves;
 * - densities and 200 % zoom: sizes follow the density, no horizontal scrolling of the page.
 *
 * Read-only for the CRM (forms are opened and validated, never saved); the settings of the theme are changed and restored.
 * The measured values go to .local/e2e-reports/<stand>/foundation.json (the expected/actual table of docs/design.md §13.4).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { tokensFor } from '../src/boot/tokens'
import { reportDir, target } from './env'
import { defaultTokens, reference } from './foundation-reference'
import { bootstrap, clearPersonal, globalScope, patchGlobal, savePersonal } from './settings-api'
import { SETTINGS, waitForShell } from './support'

test.use({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
test.beforeAll(() => {
  if (shotsDir !== '') {
    mkdirSync(shotsDir, { recursive: true })
  }
})

type Measured = Record<string, string | number>
interface Report {
  target: string
  at: string
  actual: Record<string, Measured>
  failures: string[]
}

// Playwright restarts the worker after a failed test (module state is lost): the measurements live in a file of the run,
// reset by the first test of the file.
const reportFile = resolve(reportDir(), 'foundation.json')

function readReport(): Report {
  return existsSync(reportFile) ? (JSON.parse(readFileSync(reportFile, 'utf8')) as Report) : { target, at: new Date().toISOString(), actual: {}, failures: [] }
}

function writeReport(report: Report): void {
  mkdirSync(reportDir(), { recursive: true })
  writeFileSync(reportFile, `${JSON.stringify(report, null, 1)}\n`)
}

function record(id: string, values: Measured, problems: readonly string[] = []): void {
  const report = readReport()
  report.actual[id] = values
  report.failures = [...report.failures.filter((line) => !line.startsWith(`${id}: `)), ...problems]
  writeReport(report)
}

// MU_FOUNDATION_SHOTS_DIR: screenshots of the densities, of 200 % and of the three languages (on the dev instance — a private
// directory: the pages show its data). Without it the scenario only measures.
const shotsDir = process.env['MU_FOUNDATION_SHOTS_DIR'] ?? ''
const LIST = 'index.php?module=Accounts&view=List&modernui=on'
const EDIT = 'index.php?module=Accounts&view=Edit&modernui=on'

/** Computed style of an element (with an optional pseudo element) and its box. */
async function computed(locator: Locator, properties: readonly string[]): Promise<Measured> {
  return locator.evaluate((node, props) => {
    const cs = getComputedStyle(node)
    const box = node.getBoundingClientRect()
    const out: Record<string, string | number> = { height: Math.round(box.height * 10) / 10, width: Math.round(box.width * 10) / 10 }
    for (const prop of props.filter((name) => name !== 'height' && name !== 'width')) {
      const value = cs.getPropertyValue(prop)
      out[prop] = prop === 'font-family' ? (value.split(',')[0] ?? '').replace(/["']/g, '').trim() : value
    }
    return out
  }, properties)
}

/** Measures a role and compares it with the reference; differences are collected, the test fails at the end. */
async function check(id: string, locator: Locator): Promise<Measured> {
  const expectation = reference[id]
  if (expectation === undefined) {
    throw new Error(`no reference for ${id}`)
  }
  await expect(locator, id).toHaveCount(1)
  const values = await computed(locator, Object.keys(expectation.css))
  const problems: string[] = []
  for (const [prop, expected] of Object.entries(expectation.css)) {
    if (values[prop] !== expected) {
      problems.push(`${id}: ${prop} = ${String(values[prop])}, cloud ${expected}`)
    }
  }
  for (const dimension of ['height', 'width'] as const) {
    const expected = expectation.size?.[dimension]
    if (expected !== undefined && Math.abs(Number(values[dimension]) - expected) > 2) {
      problems.push(`${id}: ${dimension} = ${String(values[dimension])}, cloud ${String(expected)} ±2`)
    }
  }
  record(id, values, problems)
  return values
}

async function settle(page: Page, ms = 250): Promise<void> {
  await page.waitForTimeout(ms)
}

/** Keyboard modality, then focus: :focus-visible like a Tab press, without walking through the page. */
async function keyboardFocus(page: Page, locator: Locator): Promise<void> {
  await page.keyboard.press('Shift')
  await locator.focus()
  expect(await locator.evaluate((node) => node.matches(':focus-visible')), 'focus-visible').toBe(true)
}

async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await waitForShell(page)
  await page.evaluate(() => document.fonts.ready)
  await settle(page, 600)
}

/**
 * The list of organizations in its "All" filter without a search: v7 keeps the last filter, sort and search of the session
 * (Vtiger_List_View: a request with `page` replaces the stored search and sort), and other scenarios (navigation.spec.ts)
 * may leave an empty one selected.
 */
async function openList(page: Page): Promise<void> {
  await openPage(page, `${LIST}&page=1`)
  const active = (await page.locator('.lists-menu > li.listViewFilter.active a.filterName').first().textContent())?.trim() ?? ''
  if (!/^(All|Все|Alle)$/.test(active)) {
    const href = await page.locator('.lists-menu > li.listViewFilter a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('href')
    expect(href, 'link of the All filter').not.toBeNull()
    await openPage(page, `${href ?? ''}&page=1&modernui=on`)
  }
  await expect(page.locator('#listview-table tbody tr.listViewEntries[data-id]').first()).toBeVisible()
}

test('tokens: the server prints the measured cloud values and the same map as the preview of the editor', async ({ page }) => {
  writeReport({ target, at: new Date().toISOString(), actual: {}, failures: [] })
  await openPage(page, LIST)
  const previous = (await globalScope(page)).values
  const appearanceKeys = ['appearance.primaryColor', 'appearance.background', 'appearance.surface', 'appearance.density', 'appearance.fontScale', 'appearance.font']
  const restore: Record<string, unknown> = Object.fromEntries(appearanceKeys.map((key) => [key, previous[key] ?? null]))
  try {
    await patchGlobal(page, Object.fromEntries(appearanceKeys.map((key) => [key, null])))
    const variants: Record<string, unknown>[] = [
      {},
      { 'appearance.primaryColor': '#7b61ff', 'appearance.density': 'compact', 'appearance.fontScale': 110 },
      { 'appearance.primaryColor': '#e55907', 'appearance.font': 'inter', 'appearance.background': '#f6f7f8' },
      { 'appearance.font': 'system', 'appearance.density': 'comfortable', 'appearance.surface': '#fdfdfd' },
    ]
    for (const variant of variants) {
      await patchGlobal(page, { ...Object.fromEntries(appearanceKeys.map((key) => [key, null])), ...variant })
      const data = await bootstrap(page)
      const appearance = data['appearance'] as Record<string, unknown> & { tokens: Record<string, string> }
      const preview = tokensFor({
        primaryColor: appearance['primaryColor'], background: appearance['background'], surface: appearance['surface'],
        density: appearance['density'], fontScale: appearance['fontScale'], font: appearance['font'],
      })
      expect(appearance.tokens, `Bootstrap = preview for ${JSON.stringify(variant)}`).toEqual(preview)
      // The render-blocking stylesheet carries the same values.
      await page.reload()
      await waitForShell(page)
      const href = await page.locator('link[rel="stylesheet"][href*="action=Tokens"]').getAttribute('href')
      const css = await (await page.request.get(href ?? '')).text()
      for (const [name, value] of Object.entries(preview)) {
        expect(css, `stylesheet --mu-${name}`).toContain(`--mu-${name}:${value}`)
      }
      if (Object.keys(variant).length === 0) {
        for (const [name, value] of Object.entries(defaultTokens)) {
          expect(preview[name as keyof typeof preview], `default token ${name}`).toBe(value)
        }
        expect(appearance['font']).toBe('cloud')
      }
    }
    // An installation that chose Inter keeps it; resetting the key returns to the new base (the cloud font).
    await patchGlobal(page, { 'appearance.font': 'inter' })
    expect(((await bootstrap(page))['appearance'] as Record<string, unknown>)['font']).toBe('inter')
    await patchGlobal(page, { 'appearance.font': null })
    const reset = (await bootstrap(page))['appearance'] as { font: string; tokens: Record<string, string> }
    expect(reset.font).toBe('cloud')
    expect(reset.tokens['font-family']).toBe('var(--mu-font-cloud)')
  } finally {
    await patchGlobal(page, restore)
  }
})

test('fonts: Poppins 400/600 and the pinned Cyrillic face, files from the CRM only, RU/EN/DE text', async ({ page, context }) => {
  const fontRequests: string[] = []
  page.on('request', (request) => {
    if (/\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(request.url()) || request.resourceType() === 'font') {
      fontRequests.push(request.url())
    }
  })
  await openPage(page, LIST)
  await page.evaluate(() => {
    const box = document.createElement('div')
    box.id = 'mu-font-probe'
    box.style.cssText = 'position:absolute;left:0;top:0;opacity:0;pointer-events:none'
    const samples: Record<string, string> = {
      en: 'Add Organization', ru: 'Съешь же ещё этих мягких французских булок', de: 'Größenänderungsübersicht, Fußgängerübergänge',
      'ru-bold': 'Съешь же ещё', 'de-bold': 'Größenänderung',
    }
    for (const [key, text] of Object.entries(samples)) {
      const node = document.createElement(key.endsWith('bold') ? 'b' : 'span')
      node.id = `mu-probe-${key}`
      node.textContent = text
      box.appendChild(node)
    }
    document.body.appendChild(box)
  })
  await page.evaluate(() => document.fonts.ready)
  const cdp = await context.newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 })
  const rendered: Record<string, string[]> = {}
  for (const key of ['en', 'ru', 'de', 'ru-bold', 'de-bold']) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#mu-probe-${key}` })
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
    rendered[key] = fonts.map((font) => font.familyName)
  }
  await page.evaluate(() => document.getElementById('mu-font-probe')?.remove())
  record('font.rendered', Object.fromEntries(Object.entries(rendered).map(([key, families]) => [key, families.join(' + ')])))
  // Latin and German: Poppins only (ä ö ü ß are in its latin subset); Cyrillic: Arial (system) or Arimo (bundled, metric-
  // compatible) — never another system font; Latin punctuation of a Cyrillic text may come from Poppins.
  expect(rendered['en']).toEqual(['Poppins'])
  expect(rendered['de']).toEqual(['Poppins'])
  expect(rendered['de-bold']).toEqual(['Poppins SemiBold'])
  for (const key of ['ru', 'ru-bold']) {
    expect(rendered[key]?.filter((family) => !family.startsWith('Poppins')), key).toEqual([expect.stringMatching(/^(?:Arial|Arimo)/)])
  }
  const loaded = await page.evaluate(() => {
    const faces: string[] = []
    document.fonts.forEach((face) => {
      if (face.status === 'loaded') {
        faces.push(`${face.family.replace(/["']/g, '')} ${face.weight}`)
      }
    })
    return [...new Set(faces)]
  })
  expect(loaded).toEqual(expect.arrayContaining(['Poppins 400', 'Poppins 600']))
  expect(loaded.filter((face) => face.startsWith('Poppins')).sort()).toEqual(['Poppins 400', 'Poppins 600'])
  // Offline: every font comes from the CRM itself, the theme's fonts from its build.
  const own = new URL(page.url()).host
  for (const url of fontRequests) {
    expect(new URL(url).host, url).toBe(own)
  }
  expect(fontRequests.some((url) => /modules\/ModernUI\/resources\/dist\/assets\/poppins-latin-400-normal-[\w-]+\.woff2$/.test(url))).toBe(true)
  await check('font.body', page.locator('body'))
})

test('list: page, primary and toolbar buttons, check boxes, rows, header, menu — the cloud states', async ({ page }) => {
  await openList(page)
  await check('page.background', page.locator('#listViewContent'))
  const add = page.locator('[id$="_basicAction_LBL_ADD_RECORD"]').first()
  await page.mouse.move(5, 995)
  await check('button.primary', add)
  await add.hover()
  await settle(page)
  await check('button.primary:hover', add)
  await page.mouse.down()
  await settle(page)
  await check('button.primary:active', add)
  await page.mouse.move(5, 995)
  await page.mouse.up()
  await settle(page)
  await keyboardFocus(page, add)
  await settle(page)
  await check('button.primary:focus-visible', add)
  await page.locator('body').evaluate((node) => (document.activeElement as HTMLElement | null)?.blur() ?? node)

  const secondary = page.locator('.module-action-content .btn-default:not([id$="_basicAction_LBL_ADD_RECORD"])').first()
  await check('button.secondary', secondary)
  await secondary.hover()
  await settle(page)
  await check('button.secondary:hover', secondary)
  await page.mouse.move(5, 995)

  const toolbar = page.locator('.listview-actions-container .btn-default:visible').filter({ hasNotText: /^$/ }).first()
  await check('button.toolbar', toolbar)

  await check('table.head', page.locator('#listview-table thead tr:first-child th:nth-child(3)'))
  // A row without the colours of extensions whose name is a link (a record without a name can be first after a sort).
  const row = page.locator('#listview-table tbody tr.listViewEntries:not([style*="background"]):has(> td.listViewEntryValue a:not(:empty))').first()
  await check('table.link', row.locator('td.listViewEntryValue a').first())
  const box = row.locator('input.listViewEntriesCheckBox')
  await check('checkbox.list', box)
  await row.locator('td.listViewEntryValue').first().hover()
  await settle(page)
  await check('table.row:hover', row.locator('td.listViewEntryValue').first())
  await box.hover()
  await settle(page)
  await check('checkbox.list:hover', box)
  await box.check()
  await settle(page)
  await check('checkbox.list:checked', box)
  await page.mouse.move(5, 995)
  await settle(page)
  await check('table.row:selected', row.locator('td.listViewEntryValue').first())
  await box.uncheck()

  // The drop-down of the action bar (More) as the menus of the cloud.
  const more = page.locator('.listViewActionsContainer .dropdown-toggle:visible').first()
  await more.click()
  const menu = page.locator('.listViewActionsContainer .open > .dropdown-menu').first()
  await expect(menu).toBeVisible()
  await check('menu.panel', menu)
  const item = menu.locator('> li > a:visible').first()
  await check('menu.item', item)
  await item.hover()
  await settle(page)
  await check('menu.item:hover', item)
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 995)
})

test('edit form: fields, focus, validation error, Select2, check box, blocks, Save and Cancel — nothing is saved', async ({ page }) => {
  const saves: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /action=Save|"action":"Save"/.test(`${request.url()} ${request.postData() ?? ''}`)) {
      saves.push(request.url())
    }
  })
  await openPage(page, EDIT)
  const form = page.locator('form#EditView')
  const name = form.locator('input[name="accountname"]')
  await check('field.input', name)
  await name.click()
  await settle(page)
  await check('field.input:focus', name)
  await check('field.label.form', form.locator('td.fieldLabel:has(+ td.fieldValue input[name="accountname"])').first())
  const textarea = form.locator('textarea.inputElement:visible').first()
  if ((await textarea.count()) > 0) {
    await check('field.textarea', textarea)
  }
  await check('block.form', form.locator('.fieldBlockContainer').first())
  await check('button.save', form.locator('.modal-overlay-footer button[type="submit"], .editViewFooter button[type="submit"]').first())
  await check('button.cancel', form.locator('.cancelLink').first())
  const checkbox = form.locator('input[type="checkbox"]:visible').first()
  if ((await checkbox.count()) > 0) {
    await check('checkbox.form', checkbox)
  }
  // Select2: box, open box, drop-down, highlighted option.
  const choice = form.locator('.select2-container:visible .select2-choice').first()
  await check('field.select2', choice)
  await choice.click()
  const drop = page.locator('.select2-drop-active:visible')
  await expect(drop).toBeVisible()
  await check('field.select2:open', choice)
  await check('field.select2.drop', drop)
  await check('field.select2.highlight', drop.locator('.select2-highlighted').first())
  await page.keyboard.press('Escape')
  // Validation error of an empty mandatory field: the error ring, no request leaves.
  await name.fill('')
  await form.locator('button[type="submit"]').first().click()
  await expect(form.locator('input[name="accountname"].input-error')).toHaveCount(1)
  await page.mouse.click(5, 995)
  await settle(page)
  await check('field.input:error', name)
  expect(saves, 'nothing was saved').toEqual([])
})

test('record, quick create, notifications, loading, empty list — the cloud states', async ({ page }) => {
  await openList(page)
  const recordId = await page.locator('#listview-table tbody tr.listViewEntries[data-id]').first().getAttribute('data-id')
  await openPage(page, `index.php?module=Accounts&view=Detail&record=${recordId ?? ''}&modernui=on`)
  await check('button.secondary', page.locator('.detailViewButtoncontainer .btn-default:visible').first())
  await check('tab.active', page.locator('.related-tabs .nav-tabs > li.active > a').first())
  const inactive = page.locator('.related-tabs .nav-tabs > li:not(.active) > a:visible').first()
  await check('tab.inactive', inactive)
  await inactive.hover()
  await settle(page)
  await check('tab.inactive:hover', inactive)
  await page.mouse.move(5, 995)
  await check('field.label.detail', page.locator('.summaryViewFields td.fieldLabel, .detailview-table td.fieldLabel').first())

  // Quick create of a contact (opened and closed, never saved).
  await page.locator('#menubar_quickCreate').click()
  await page.locator('#menubar_quickCreate_Contacts').click()
  const quick = page.locator('.modal-content:has(form[name="QuickCreate"])')
  await expect(quick).toBeVisible()
  await settle(page, 600)
  await check('dialog.content', quick)
  await check('dialog.footer', quick.locator('.modal-footer').first())
  await check('dialog.backdrop', page.locator('.modal-backdrop.in').first())
  await check('button.save', quick.locator('button[type="submit"]').first())
  await check('button.cancel', quick.locator('.cancelLink').first())
  await quick.locator('.cancelLink').first().click()
  await expect(quick).toBeHidden()

  // Notifications of v7 (app.helper, client only) and the progress indicator.
  const kinds = await page.evaluate(() => {
    const helper = (window as unknown as { app?: { helper?: Record<string, (options: unknown) => void> } }).app?.helper
    helper?.['showSuccessNotification']?.({ message: 'MU10 success' })
    helper?.['showErrorNotification']?.({ message: 'MU10 error' })
    helper?.['showProgress']?.({})
    return helper !== undefined
  })
  expect(kinds, 'app.helper of v7').toBe(true)
  const notes = page.locator('.vt-notification:visible')
  await expect(notes.first()).toBeVisible()
  const note = await computed(notes.first(), ['background-color', 'border-top-left-radius', 'box-shadow', 'font-family', 'border-left-width'])
  record('notification', note)
  expect(note['background-color']).toBe('rgb(255, 255, 255)')
  expect(note['font-family']).toBe('Poppins')
  expect(note['box-shadow']).toBe('rgba(0, 0, 0, 0.25) 0px 1px 10px 0px')
  const progress = await computed(page.locator('#messageBar > div').first(), ['background-color', 'border-top-left-radius'])
  record('loading', progress)
  expect(progress['background-color']).toBe('rgb(255, 255, 255)')
  await page.evaluate(() => (window as unknown as { app?: { helper?: { hideProgress?: () => void } } }).app?.helper?.hideProgress?.())

  // Empty list: the message of v7 in the secondary text colour.
  await openPage(page, `index.php?module=Accounts&view=List&search_params=${encodeURIComponent(JSON.stringify([[['accountname', 'c', 'zzMU10nomatchzz']]]))}&modernui=on`)
  const empty = page.locator('.emptyRecordsDiv .emptyRecordsContent, .listview-table-norecords .emptyRecordsContent').first()
  await expect(empty).toBeVisible()
  const emptyStyle = await computed(empty, ['color', 'font-family'])
  record('empty', emptyStyle)
  expect(emptyStyle['color']).toBe('rgb(89, 93, 93)')
  expect(emptyStyle['font-family']).toBe('Poppins')
  // The search of this check stays in the session of v7 otherwise.
  await openList(page)
})

test('settings editor of ModernUI: buttons, fields, tabs, disabled Save in the same foundation', async ({ page }) => {
  await openPage(page, SETTINGS)
  const editor = page.locator('.mu-editor')
  await expect(editor).toBeVisible()
  const save = editor.locator('.mu-btn--primary').last()
  const saveState = await computed(save, ['background-color', 'color', 'border-top-left-radius', 'font-family', 'font-weight', 'opacity'])
  record('editor.save', saveState)
  expect(saveState['background-color']).toBe('rgb(57, 120, 254)')
  expect(saveState['font-weight']).toBe('400')
  if (await save.isDisabled()) {
    await check('button.disabled', save)
  }
  const secondary = editor.locator('.mu-btn:not(.mu-btn--primary):not(.mu-btn--danger):visible').first()
  const secondaryState = await computed(secondary, ['background-color', 'border-top-color', 'color'])
  record('editor.secondary', secondaryState)
  expect(secondaryState['background-color']).toBe('rgb(240, 241, 243)')
  const input = editor.locator('.mu-input:visible, .mu-select:visible').first()
  const inputState = await computed(input, ['border-top-color', 'border-top-left-radius', 'color', 'font-family'])
  record('editor.input', inputState)
  expect(inputState['border-top-color']).toBe('rgb(223, 225, 230)')
  expect(inputState['font-family']).toBe('Poppins')
  const activeTab = await computed(editor.locator('.mu-tabs__tab[data-state="active"]').first(), ['color', 'box-shadow', 'font-weight', 'font-size'])
  record('editor.tab', activeTab)
  expect(activeTab['color']).toBe('rgb(28, 33, 33)')
  expect(activeTab['box-shadow']).toBe('rgb(57, 120, 254) 0px -3px 0px 0px inset')
  expect(activeTab['font-weight']).toBe('400')
})

test('densities and 200 % zoom: sizes follow the density, the page does not scroll sideways', async ({ page }) => {
  await openPage(page, LIST)
  const measures: Record<string, Measured> = {}
  try {
    for (const [density, input, row] of [['compact', 30, 32], ['standard', 36, 40], ['comfortable', 40, 48]] as const) {
      const saved = await savePersonal(page, { 'appearance.density': density })
      expect(saved.ok, saved.text.slice(0, 200)).toBe(true)
      await openPage(page, EDIT)
      const field = await computed(page.locator('form#EditView input[name="accountname"]'), [])
      await openList(page)
      // The lowest row of the page: rows with wrapped values (long addresses) are taller than the density.
      const cells = await page.locator('#listview-table tbody').evaluate((body) => Math.min(...Array.from(body.querySelectorAll('tr.listViewEntries')).map((row) => row.getBoundingClientRect().height)))
      measures[density] = { input: field['height'] ?? 0, row: Math.round(cells) }
      if (shotsDir !== '') {
        await page.screenshot({ path: resolve(shotsDir, `list-${density}.png`) })
      }
      expect(Number(field['height']), `${density} field`).toBeCloseTo(input, 0)
      // Compact: the row actions of v7 (a 23 px box with 8 px padding) keep a row at 40 px; standard and comfortable exact.
      expect(cells, `${density} row`).toBeGreaterThanOrEqual(row - 1)
      expect(cells, `${density} row`).toBeLessThanOrEqual(density === 'compact' ? 40 : row + 1)
    }
  } finally {
    await clearPersonal(page)
  }
  record('density', Object.fromEntries(Object.entries(measures).map(([key, value]) => [key, `${String(value['input'])} / ${String(value['row'])}`])))
  // 200 % of a 1440 px window: 720 CSS px.
  await page.setViewportSize({ width: 720, height: 500 })
  for (const url of [LIST, EDIT, SETTINGS]) {
    await openPage(page, url)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${url}: horizontal scroll at 200 %`).toBeLessThanOrEqual(1)
    if (shotsDir !== '') {
      await page.screenshot({ path: resolve(shotsDir, `zoom200-${new URL(url, 'http://x/').searchParams.get('view') ?? 'page'}-${new URL(url, 'http://x/').searchParams.get('module') ?? ''}.png`), fullPage: false })
    }
  }
})

test('languages: the texts of the theme in RU, EN and DE use the cloud font and the pinned Cyrillic, long labels fit', async ({ page }) => {
  await openPage(page, SETTINGS)
  const results: Measured = {}
  try {
    for (const locale of ['ru-RU', 'en-US', 'de-DE'] as const) {
      const saved = await savePersonal(page, { locale })
      expect(saved.ok, saved.text.slice(0, 200)).toBe(true)
      await openPage(page, SETTINGS)
      await expect(page.locator('.mu-editor')).toBeVisible()
      const state = await page.evaluate(() => {
        const editor = document.querySelector('.mu-editor')
        const tab = document.querySelector('.mu-tabs__tab')
        return {
          lang: document.documentElement.getAttribute('data-mu-locale') ?? '',
          font: tab === null ? '' : (getComputedStyle(tab).fontFamily.split(',')[0] ?? '').replace(/["']/g, '').trim(),
          overflow: editor === null ? -1 : editor.scrollWidth - editor.clientWidth,
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          label: tab?.textContent.trim() ?? '',
        }
      })
      results[locale] = `${state.lang} ${state.font} «${state.label}» overflow ${String(state.overflow)}/${String(state.page)}`
      expect(state.lang).toBe(locale)
      expect(state.font).toBe('Poppins')
      expect(state.overflow, `${locale}: editor overflows`).toBeLessThanOrEqual(1)
      expect(state.page, `${locale}: page scrolls sideways`).toBeLessThanOrEqual(1)
      if (shotsDir !== '') {
        await page.screenshot({ path: resolve(shotsDir, `editor-${locale}.png`) })
      }
    }
  } finally {
    await clearPersonal(page)
  }
  record('languages', results)
})

/** Roles of the reference no scenario measured on this stand (an instance without a check box in the form skips one). */
function unmeasured(report: Report): string[] {
  const optional = new Set(['checkbox.form', 'field.textarea', 'button.disabled', 'badge'])
  return Object.keys(reference).filter((id) => report.actual[id] === undefined && !optional.has(id))
}

test('every measured role matches the cloud reference (or is a documented exception)', () => {
  const report = readReport()
  expect(report.failures, report.failures.join('\n')).toEqual([])
  expect(unmeasured(report)).toEqual([])
})
