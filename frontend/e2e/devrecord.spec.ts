/**
 * A synthetic record written through the standard edit form while the theme is on (task test:devrecord), to show
 * where a scenario write lands: in the database of the instance only (checked from outside with a read-only
 * query), never in files of the repository or the CRM. Two phases, so the check runs between them:
 *
 *   MU_DEVRECORD=create      — creates a Calendar task "ModernUI synthetic task …" of the signed-in user, prints its id;
 *   MU_DEVRECORD=delete:<id> — deletes that record through the standard delete action (only a synthetic one).
 *
 * Run it only after checking that the outgoing integrations of the instance are off (docs/DEVELOPMENT.md).
 */
import { expect, test } from '@playwright/test'
import { HOME, waitForShell } from './support'

const phase = process.env['MU_DEVRECORD'] ?? ''
const SUBJECT_PREFIX = 'ModernUI synthetic task'

test('synthetic record through the standard form with the theme on', async ({ page }) => {
  test.skip(phase === '', 'set MU_DEVRECORD=create or MU_DEVRECORD=delete:<id>')
  await page.goto(HOME)
  await waitForShell(page)
  expect(await page.evaluate(() => document.documentElement.classList.contains('mu-shell-ready'))).toBe(true)

  if (phase === 'create') {
    const subject = `${SUBJECT_PREFIX} Ä ${new Date().toISOString()}`
    await page.goto('index.php?module=Calendar&view=Edit')
    const form = page.locator('form#EditView')
    await expect(form).toBeVisible()
    await form.locator('input[name="subject"]').fill(subject)
    // Mandatory pick-lists without a default value (instances may require more than the core does).
    await form.evaluate((element: HTMLFormElement) => {
      for (const select of Array.from(element.querySelectorAll<HTMLSelectElement>('select[data-rule-required="true"]'))) {
        if (select.value === '') {
          const option = Array.from(select.options).find((item) => item.value !== '')
          if (option !== undefined) {
            select.value = option.value
            select.dispatchEvent(new Event('change', { bubbles: true }))
          }
        }
      }
    })
    await Promise.all([page.waitForURL(/view=Detail&record=\d+/), form.locator('button[type="submit"]:visible').last().click()])
    const record = new URL(page.url()).searchParams.get('record')
    expect(record).toMatch(/^\d+$/)
    await waitForShell(page)
    console.log(`[devrecord] created Calendar record ${record ?? ''}: ${subject}`)
    return
  }

  const match = /^delete:(\d+)$/.exec(phase)
  expect(match, 'MU_DEVRECORD=delete:<id>').not.toBeNull()
  const record = match?.[1] ?? ''
  await page.goto(`index.php?module=Calendar&view=Detail&record=${record}`)
  // Only the synthetic record of this scenario may be deleted.
  await expect(page.locator('body')).toContainText(SUBJECT_PREFIX)
  const token = (await page.locator('input[name="__vtrftk"]').first().getAttribute('value')) ?? ''
  const response = await page.request.post('index.php', {
    form: { module: 'Calendar', action: 'DeleteAjax', record, __vtrftk: token },
    headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: page.url() },
  })
  expect(response.status()).toBe(200)
  expect(((await response.json()) as { success?: boolean }).success).toBe(true)
  console.log(`[devrecord] deleted Calendar record ${record}`)
})
