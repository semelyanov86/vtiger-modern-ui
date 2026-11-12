/** Reversible setup for visual comparisons. The recovery file survives a killed browser or test process. */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { repoRoot, target } from './env'
import { bootstrap, clearPersonal, globalScope, saveGlobal, savePersonal } from './settings-api'

interface Backup {
  global: Record<string, unknown>
  personal: Record<string, unknown>
}

export async function prepareVisualSettings(
  page: Page, modules: readonly string[], options: { defaults?: boolean; favorites?: string[] } = {},
): Promise<() => Promise<void>> {
  const dir = resolve(repoRoot, '.local')
  const file = resolve(dir, `visual-settings-${target}.json`)
  mkdirSync(dir, { recursive: true })
  const personal = async (): Promise<Record<string, unknown>> =>
    ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
  const restore = async (before: Backup): Promise<void> => {
    await page.goto('index.php?module=Home&view=DashBoard&modernui=on')
    expect((await saveGlobal(page, before.global)).ok, 'restore global visual settings').toBe(true)
    await clearPersonal(page)
    if (Object.keys(before.personal).length > 0) {
      expect((await savePersonal(page, before.personal)).ok, 'restore personal visual settings').toBe(true)
    }
    expect((await globalScope(page)).values).toEqual(before.global)
    expect(await personal()).toEqual(before.personal)
    unlinkSync(file)
  }
  // A prior interrupted run must be recovered explicitly before taking a new snapshot of the user's settings.
  if (existsSync(file)) {
    expect(process.env['MU_VISUAL_RECOVER'], `pending settings backup: ${file}; rerun with MU_VISUAL_RECOVER=1`).toBe('1')
    await restore(JSON.parse(readFileSync(file, 'utf8')) as Backup)
  }
  const before: Backup = { global: (await globalScope(page)).values, personal: await personal() }
  writeFileSync(file, `${JSON.stringify(before, null, 2)}\n`, { mode: 0o600 })
  try {
    // Presentation defaults still need an explicit activation policy: a new installation defaults to theme.mode=off.
    expect((await saveGlobal(page, { ...(options.defaults ? { 'theme.mode': 'all' } : before.global), 'layout.modules': [...new Set(modules)] })).ok).toBe(true)
    if (options.defaults) await clearPersonal(page)
    if (options.favorites) {
      expect((await savePersonal(page, { 'navigation.favorites': options.favorites })).ok).toBe(true)
    }
  } catch (error) {
    await restore(before)
    throw error
  }
  return async () => { await restore(before) }
}
