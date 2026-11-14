/** Release acceptance: persisted native CRUD in every theme language, compared with the same CRM OFF. */
import { expect, test } from '@playwright/test'
import { bootstrap, clearPersonal, savePersonal } from './settings-api'
import { deleteSynthetic, fillMandatory, isSave, payload, settle } from './records-support'
import { isolateNetwork, waitForShell } from './support'

for (const locale of ['ru-RU', 'en-US', 'de-DE']) {
  for (const mode of ['off', 'on'] as const) {
    test(`${locale} ${mode}: create, read, update and delete persist in the native CRM`, async ({ page, context }) => {
      await isolateNetwork(context)
      await page.goto('index.php?module=Accounts&view=List&modernui=on')
      const personal = ((await bootstrap(page))['personal'] as { values: Record<string, unknown> }).values
      const name = `MU21-${locale}-${mode}-${Date.now().toString(36)} Тест Größe`
      let record = ''
      // Keep the created ID even if a later browser assertion fails, so cleanup remains possible.
      page.on('response', (response) => {
        if (!isSave('Accounts')(response.request())) return
        const fields = new Map(payload(response.request()))
        const location = response.headers()['location']
        if (!fields.get('record') && location) record = new URL(location, page.url()).searchParams.get('record') ?? ''
      })
      try {
        expect((await savePersonal(page, { locale })).ok).toBe(true)
        await page.goto(`index.php?module=Accounts&view=Edit&modernui=${mode}`)
        if (mode === 'on') {
          await waitForShell(page)
          await expect(page.locator('html')).toHaveAttribute('data-mu-locale', locale)
        }
        await settle(page)
        expect(await fillMandatory(page, mode)).toEqual([])
        await page.locator('form#EditView [name="accountname"]').fill(name)
        const created = page.waitForResponse((response) => isSave('Accounts')(response.request()))
        await page.locator('form#EditView .saveButton').click()
        expect((await created).status()).toBe(302)
        await page.waitForURL((url) => url.searchParams.get('view') === 'Detail' && /^\d+$/.test(url.searchParams.get('record') ?? ''))
        expect(record).toMatch(/^\d+$/)
        await page.goto(`index.php?module=Accounts&view=Edit&record=${record}&modernui=off`)
        await expect(page.locator('form#EditView [name="accountname"]')).toHaveValue(name)
        await page.goto(`index.php?module=Accounts&view=Edit&record=${record}&modernui=${mode}`)
        await settle(page)
        await page.locator('form#EditView [name="accountname"]').fill(`${name} Edited`)
        const updated = page.waitForResponse((response) => isSave('Accounts')(response.request()))
        await page.locator('form#EditView .saveButton').click()
        expect((await updated).status()).toBe(302)
        await page.waitForURL((url) => url.searchParams.get('view') === 'Detail')
        await page.goto(`index.php?module=Accounts&view=Edit&record=${record}&modernui=off`)
        await expect(page.locator('form#EditView [name="accountname"]')).toHaveValue(`${name} Edited`)
        await deleteSynthetic(page, 'Accounts', record, 'MU21-')
        record = ''
        const search = encodeURIComponent(JSON.stringify([[['accountname', 'c', name]]]))
        await page.goto(`index.php?module=Accounts&view=List&modernui=${mode}&search_params=${search}`)
        await expect(page.locator('tr.listViewEntries')).toHaveCount(0)
      } finally {
        try {
          if (record) await deleteSynthetic(page, 'Accounts', record, 'MU21-')
        } finally {
          await page.goto('index.php?module=Accounts&view=List&modernui=on')
          await clearPersonal(page)
          if (Object.keys(personal).length) expect((await savePersonal(page, personal)).ok).toBe(true)
        }
      }
    })
  }
}
