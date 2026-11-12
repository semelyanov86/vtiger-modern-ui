/**
 * Screens of ModernUI for the comparison with the cloud reference (stage 09, docs/visual-parity.md §3, §5): every state of
 * dev/visual/states.json at 1440×1000, DPR 1 — a screenshot and the measurements of its elements, in the format of the cloud
 * measurements, into MU_VISUAL_DIR (on the dev instance a private directory: the pages show its data). Read-only: the
 * scenario opens records and forms and never saves; layout.modules of the state is switched on for the run and restored.
 * The comparison itself is dev/visual/compare.py (no access to the cloud, nothing of it in CI).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from '@playwright/test'
import { repoRoot } from './env'
import { waitForShell } from './support'
import { visualStep } from './visual-steps'
import { prepareVisualSettings } from './visual-settings'

interface StateSpec {
  readonly id: string
  readonly module: string
  readonly url: string
  readonly steps: readonly string[]
  readonly elements: Readonly<Record<string, { readonly theme: string; readonly pseudo?: string }>>
}

const spec = JSON.parse(readFileSync(resolve(repoRoot, process.env['MU_VISUAL_STATES'] ?? 'dev/visual/states.json'), 'utf8')) as {
  viewport: { width: number; height: number }
  prepare?: { defaults?: boolean; favorites?: string[] }
  states: readonly StateSpec[]
}
const dir = process.env['MU_VISUAL_DIR'] ?? ''

test.use({ viewport: spec.viewport, deviceScaleFactor: 1 })

test('screens and measurements of ModernUI for the pairs with the cloud', async ({ page }) => {
  test.skip(dir === '', 'MU_VISUAL_DIR is not set (on the dev instance: a private directory)')
  test.setTimeout(600_000)
  mkdirSync(dir, { recursive: true })
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  const restore = await prepareVisualSettings(page, spec.states.map((state) => state.module), spec.prepare)
  const result: Record<string, unknown> = {}
  try {
    // Polls of the CRM keep the network busy: fixed short waits instead of network idle.
    for (const state of spec.states) {
      console.log(`[pairs] ${state.id} ${new Date().toISOString()}`)
      await page.goto(`${state.url}&modernui=on`)
      await waitForShell(page)
      await page.waitForTimeout(1200)
      for (const name of state.steps) {
        console.log(`[pairs]   step ${name}`)
        await visualStep(page, name)
      }
      console.log('[pairs]   measure')
      await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, { timeout: 15_000 })
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
          const cs = getComputedStyle(node, element.pseudo)
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
    await restore()
  }
  writeFileSync(resolve(dir, 'measurements.json'), `${JSON.stringify(result, null, 1)}\n`)
})
