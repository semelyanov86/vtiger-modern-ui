/**
 * Screens of ModernUI for the comparison with the cloud reference (stage 09, docs/visual-parity.md §3, §5): every state of
 * dev/visual/states.json at 1440×1000, DPR 1 — a screenshot and the measurements of its elements, in the format of the cloud
 * measurements, into MU_VISUAL_DIR (on the dev instance a private directory: the pages show its data). Read-only: the
 * scenario opens records and forms and never saves; layout.modules of the state is switched on for the run and restored.
 * The comparison itself is dev/visual/compare.py (no access to the cloud, nothing of it in CI).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { repoRoot } from './env'
import { globalScope, patchGlobal } from './settings-api'
import { openListFilters, openListSearch, waitForShell } from './support'

interface StateSpec {
  readonly id: string
  readonly module: string
  readonly url: string
  readonly steps: readonly string[]
  readonly elements: Readonly<Record<string, { readonly theme: string }>>
}

const spec = JSON.parse(readFileSync(resolve(repoRoot, process.env['MU_VISUAL_STATES'] ?? 'dev/visual/states.json'), 'utf8')) as {
  viewport: { width: number; height: number }
  states: readonly StateSpec[]
}
const dir = process.env['MU_VISUAL_DIR'] ?? ''

test.use({ viewport: spec.viewport, deviceScaleFactor: 1 })

async function step(page: Page, name: string): Promise<void> {
  if (name === 'all-records') {
    // Native filter IDs differ between installations. Clear the previous test's search through its own All link.
    const href = await page.locator('.lists-menu a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('href')
    expect(href, 'native All filter').toBeTruthy()
    await page.goto(`${href ?? ''}&search_params=%5B%5D&page=1&modernui=on`)
    await waitForShell(page)
  } else if (name === 'open-list-filters') {
    await openListFilters(page)
  } else if (name === 'select-first') {
    await page.locator('#listview-table .listViewEntriesCheckBox').first().check()
  } else if (name === 'sort-first') {
    await page.locator('.listViewContentHeaderValues').first().click()
    await page.waitForLoadState('networkidle')
  } else if (name === 'search-empty') {
    await openListSearch(page)
    const input = page.locator('.searchRow input.listSearchContributor:visible').first()
    await input.fill('MU12-no-such-record')
    await input.press('Enter')
    await expect(page.locator('.emptyRecordsDiv')).toBeVisible()
    await page.locator('.mu-list-search').click()
  } else if (name === 'open-first-record') {
    await page.locator('#listViewContent tr.listViewEntries[data-id] a[href*="view=Detail"]:not([href*="mode="])').filter({ visible: true }).first().click()
    await expect(page.locator('html[data-mu-record]')).toHaveCount(1)
    await expect(page.locator('#overlayPageContent.in .overlayDetail')).toBeVisible()
  } else if (name === 'open-menu') {
    await page.locator('[data-mu-trigger="mega-menu"]').click()
    await expect(page.locator('[data-mu-panel="mega-menu"]')).toBeVisible()
    await expect(page.locator('[data-mu-field="menu-search"]')).toBeFocused()
  } else if (name === 'search-nothing') {
    await page.locator('[data-mu-field="menu-search"]').fill('zzqx')
    await expect(page.locator('.mu-mega__empty')).toBeVisible()
  } else if (name === 'open-edit') {
    await page.locator('#overlayPageContent .editRelatedRecord').click()
    await expect(page.locator('#overlayPageContent form#EditView')).toBeVisible()
  } else {
    throw new Error(`unknown step ${name}`)
  }
  await page.waitForTimeout(800)
}

test('screens and measurements of ModernUI for the pairs with the cloud', async ({ page }) => {
  test.skip(dir === '', 'MU_VISUAL_DIR is not set (on the dev instance: a private directory)')
  test.setTimeout(600_000)
  mkdirSync(dir, { recursive: true })
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  // MU_LAYOUT_RESET=1: the setting is removed at the end (after an interrupted run left the value of the scenario).
  const previous = process.env['MU_LAYOUT_RESET'] === '1' ? null : (await globalScope(page)).values['layout.modules']
  const result: Record<string, unknown> = {}
  try {
    // Polls of the CRM keep the network busy: fixed short waits instead of network idle.
    await patchGlobal(page, { 'layout.modules': [...new Set(spec.states.map((state) => state.module))] })
    for (const state of spec.states) {
      console.log(`[pairs] ${state.id} ${new Date().toISOString()}`)
      await page.goto(`${state.url}&modernui=on`)
      await waitForShell(page)
      await page.waitForTimeout(1200)
      for (const name of state.steps) {
        console.log(`[pairs]   step ${name}`)
        await step(page, name)
      }
      console.log('[pairs]   measure')
      await page.waitForTimeout(500)
      const items = await page.evaluate((elements) => {
        const out: Record<string, unknown> = {}
        for (const [id, element] of Object.entries(elements)) {
          const node = document.querySelector(element.theme)
          if (node === null) {
            out[id] = { sel: element.theme, missing: true }
            continue
          }
          const r = node.getBoundingClientRect()
          const cs = getComputedStyle(node)
          const border = (side: string): string => `${cs.getPropertyValue(`border-${side}-width`)} ${cs.getPropertyValue(`border-${side}-style`)} ${cs.getPropertyValue(`border-${side}-color`)}`
          out[id] = {
            sel: element.theme,
            box: [r.x, r.y, r.width, r.height].map((value) => Math.round(value * 10) / 10),
            font: cs.fontFamily.split(',')[0]?.replace(/"/g, '').trim() ?? '', size: cs.fontSize, weight: cs.fontWeight, lh: cs.lineHeight,
            color: cs.color, bg: cs.backgroundColor, bTop: border('top'), bBottom: border('bottom'), bLeft: border('left'), radius: cs.borderRadius,
            pad: cs.padding, shadow: cs.boxShadow === 'none' ? '' : cs.boxShadow, tt: cs.textTransform === 'none' ? '' : cs.textTransform,
          }
        }
        return out
      }, state.elements)
      result[state.id] = { url: state.url, at: new Date().toISOString(), viewport: [spec.viewport.width, spec.viewport.height, 1], items }
      await page.screenshot({ path: resolve(dir, `${state.id}.png`) })
      if (state.steps.length > 0) {
        await page.keyboard.press('Escape')
      }
    }
  } finally {
    await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
    await patchGlobal(page, { 'layout.modules': previous ?? null })
  }
  writeFileSync(resolve(dir, 'measurements.json'), `${JSON.stringify(result, null, 1)}\n`)
})
