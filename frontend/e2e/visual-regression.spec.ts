/** Stage 18: capture deterministic regions on an isolated, seeded PACKAGE instance. Never updates a baseline. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { isClean, repoRoot, target } from './env'
import { savePersonal } from './settings-api'
import { isolateNetwork, waitForShell } from './support'
import { prepareVisualSettings } from './visual-settings'
import { visualStep } from './visual-steps'

interface Scene {
  id: string
  module: string
  url: string
  steps: string[]
  region: string | { x: number; y: number; width: number; height: number }
  viewport?: { width: number; height: number }
  locale?: string
}
const scenes = JSON.parse(readFileSync(resolve(repoRoot, 'dev/visual/regression.json'), 'utf8')) as Scene[]
const output = resolve(repoRoot, process.env['MU_REGRESSION_DIR'] ?? `.local/visual-regression/${target}`)

test('capture accepted visual regions, with clean synthetic data only', async ({ page, context, browser }) => {
  expect(isClean, 'visual regression capture is restricted to the isolated clean instances').toBe(true)
  test.setTimeout(600_000)
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(30_000)
  await isolateNetwork(context)
  await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
  const restore = await prepareVisualSettings(page, scenes.map((scene) => scene.module), {
    defaults: true, favorites: ['Accounts', 'Contacts'],
  })
  mkdirSync(output, { recursive: true })
  const measurements: Record<string, unknown> = {}
  try {
    for (const scene of scenes) {
      console.log(`[visual-regression] open ${scene.id}`)
      const viewport = scene.viewport ?? { width: 1440, height: 1000 }
      await page.setViewportSize(viewport)
      expect((await savePersonal(page, { locale: scene.locale ?? 'en-US' })).ok).toBe(true)
      await page.goto(`${scene.url}&modernui=on`)
      await waitForShell(page)
      await expect(page.locator('html')).toHaveClass(/mu-shell-ready/)
      for (const step of scene.steps) await visualStep(page, step)
      await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, { timeout: 15_000 })
      await page.mouse.move(viewport.width - 2, viewport.height - 2)
      await page.waitForTimeout(350)
      const locator = typeof scene.region === 'string' ? page.locator(scene.region).first() : null
      if (locator) await expect(locator, scene.id).toBeVisible()
      const box = locator ? await locator.boundingBox() : scene.region
      expect(box, `${scene.id}: region exists`).toBeTruthy()
      if (box === null || typeof box === 'string') throw new Error('invalid visual region')
      expect(box.width, scene.id).toBeGreaterThan(0)
      expect(box.height, scene.id).toBeGreaterThan(0)
      expect(box.x + box.width, `${scene.id}: region fits viewport`).toBeLessThanOrEqual(viewport.width + 1)
      expect(box.y + box.height, `${scene.id}: region fits viewport`).toBeLessThanOrEqual(viewport.height + 1)
      // Wait for two identical paints, as a one-frame compositor/font change is not an accepted reference.
      // Position is checked separately so capturing the real rectangle cannot conceal a moved panel.
      let previous: Buffer | undefined
      let stable: Buffer | undefined
      for (let attempt = 0; attempt < 10; attempt++) {
        const current = await page.screenshot({ clip: box, animations: 'disabled', caret: 'hide', timeout: 30_000 })
        if (previous?.equals(current)) { stable = current; break }
        previous = current
        await page.waitForTimeout(200)
      }
      expect(stable, `${scene.id}: two consecutive paints must agree`).toBeDefined()
      if (!stable) throw new Error(`${scene.id}: unstable visual capture`)
      writeFileSync(resolve(output, `${scene.id}.png`), stable)
      measurements[scene.id] = { box, viewport, locale: scene.locale ?? 'en-US', masks: [] }
      console.log(`[visual-regression] ${scene.id}`)
      await page.keyboard.press('Escape')
    }
  } finally {
    await restore()
  }
  writeFileSync(resolve(output, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`)
  writeFileSync(resolve(output, 'runtime.json'), `${JSON.stringify({ browser: browser.version(), target }, null, 2)}\n`)
})
