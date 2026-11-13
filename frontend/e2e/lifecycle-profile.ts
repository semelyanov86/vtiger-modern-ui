/** Synthetic clean-instance evidence: native contracts plus screenshots for a separate visual review. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'
import { reportDir } from './env'
import { openCloudRecord, recordContract, recordTab } from './cloud-records-support'
import { formData, settle } from './records-support'
import { bootstrap, get } from './settings-api'
import { PREFERENCES, SETTINGS, waitForShell } from './support'

export async function captureLifecycleProfile(page: Page, label: string, admin: boolean, record?: string): Promise<void> {
  const output = resolve(reportDir(), 'lifecycle-profiles', label)
  mkdirSync(output, { recursive: true })
  const evidence: Record<string, unknown> = { label, admin, visual: 'screenshots require review', fields: 'pending', form: 'pending' }
  const shot = async (name: string): Promise<void> => {
    await page.waitForFunction(() => document.fonts.status === 'loaded')
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('index.php?module=Accounts&view=List&modernui=on')
  await waitForShell(page)
  const data = await bootstrap(page)
  evidence['locale'] = data['locale']
  evidence['personal'] = data['personal']
  const id = record ?? await page.locator('tr.listViewEntries').first().getAttribute('data-id') ?? ''
  expect(id).toMatch(/^\d+$/)
  await shot('list')
  await page.locator('[data-mu-trigger="mega-menu"]').click()
  await expect(page.locator('[data-mu-panel="mega-menu"]')).toBeVisible()
  await shot('menu')
  await page.keyboard.press('Escape')
  await openCloudRecord(page, 'Accounts', id)
  await shot('summary')
  await recordTab(page, '[data-link-key="LBL_RECORD_DETAILS"]')
  const overlay = (await recordContract(page)).fields
  await shot('details')
  await page.locator('.mu-record-back').click({ noWaitAfter: true })
  await expect(page.locator('html')).not.toHaveAttribute('data-mu-record')
  const direct = `index.php?module=Accounts&view=Detail&record=${id}&mode=showDetailViewByMode&requestMode=full`
  await page.goto(`${direct}&modernui=off`)
  await settle(page)
  expect(overlay).toEqual((await recordContract(page)).fields)
  await page.goto(`${direct}&modernui=on`)
  await waitForShell(page)
  expect((await recordContract(page)).fields).toEqual(overlay)
  await shot('direct')
  evidence['fields'] = 'OFF direct = ON overlay = ON direct'
  const edit = `index.php?module=Accounts&view=Edit&record=${id}`
  await page.goto(`${edit}&modernui=off`)
  await settle(page)
  const native = await formData(page)
  await page.goto(`${edit}&modernui=on`)
  await waitForShell(page)
  await settle(page)
  expect(await formData(page)).toEqual(native)
  await shot('edit')
  evidence['form'] = 'OFF = ON native payload; no save'
  await page.goto(admin ? 'index.php?module=Vtiger&parent=Settings&view=Index&modernui=on' : `${PREFERENCES}&modernui=on`)
  await waitForShell(page)
  await shot('settings')
  if (!admin) {
    await page.goto(SETTINGS)
    await expect(page.locator('[data-mu-root="settings-editor"]')).toHaveCount(0)
    const forbidden = await get(page, { module: 'ModernUI', parent: 'Settings', action: 'Data' })
    expect(forbidden.ok).toBe(false)
    expect(forbidden.result).toEqual({})
    expect(forbidden.text).toMatch(/permission denied|LBL_PERMISSION_DENIED|denied\.gif|not permitted/i)
    evidence['adminAccess'] = 'server page has no editor; Data API denies access and returns no settings'
  }
  writeFileSync(resolve(output, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
}
