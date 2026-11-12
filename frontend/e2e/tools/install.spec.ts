/**
 * The standard web installer of Vtiger 8.4.0 on a clean instance (task clean:install → project "install").
 * Language en_us, "Create new database" (the installer itself runs CREATE DATABASE … utf8), admin password
 * from .local/clean/<instance>.env. The vendor's statistics pixel and registration are not reached: the browser
 * talks to the CRM only, the web server has no internet route.
 */
import { expect, test, type Locator } from '@playwright/test'
import { adminCredentials, cleanDbPassword, crmUrl, isClean, target } from '../env'
import { isolateNetwork } from '../support'

async function waitForClickHandler(control: Locator) {
  // Installer buttons are painted before its footer script binds their native jQuery handlers.
  await expect.poll(() => control.evaluate((element) => {
    const jq = (window as unknown as {
      jQuery?: { _data: (node: Element, key: string) => { click?: unknown[] } | undefined }
    }).jQuery
    return jq?._data(element, 'events')?.click?.length ?? 0
  }), { message: 'the installer click handler must be ready' }).toBeGreaterThan(0)
}

test('install Vtiger 8.4.0 with the web installer', async ({ page, context }) => {
  test.skip(!isClean, 'the installer runs on the clean stand only')
  test.setTimeout(30 * 60_000)
  const blocked = await isolateNetwork(context)
  const admin = adminCredentials()
  const dbPassword = cleanDbPassword()
  // Step 3 asks for confirmation when a recommended setting differs; the answer is logged in the report.
  const dialogs: string[] = []
  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message())
    await dialog.accept()
  })

  await page.goto('index.php')
  await expect(page).toHaveURL(/module=Install/)
  await page.locator('form[name="step1"] input[type="submit"]').click()
  await page.locator('#agree').click()
  await expect(page.locator('form[name="step3"]')).toBeVisible()
  await waitForClickHandler(page.locator('input[name="step4"]'))
  const failedChecks = await page.locator('form[name="step3"] .no, form[name="step3"] .alert-error').allInnerTexts()
  await page.locator('input[name="step4"]').click()

  const step4 = page.locator('form[name="step4"]')
  await expect(step4).toBeVisible()
  await waitForClickHandler(step4.locator('input[name="step5"]'))
  await step4.locator('input[name="db_hostname"]').fill('db')
  await step4.locator('input[name="db_username"]').fill('vtiger')
  await step4.locator('input[name="db_password"]').fill(dbPassword)
  await step4.locator('input[name="db_name"]').fill(`vtiger_${target}`)
  await step4.locator('input[name="create_db"]').check()
  await step4.locator('input[name="db_root_username"]').fill('vtiger')
  await step4.locator('input[name="db_root_password"]').fill(dbPassword)
  await step4.locator('input[name="password"]').fill(admin.password)
  await step4.locator('input[name="retype_password"]').fill(admin.password)
  await step4.locator('input[name="firstname"]').fill('Clean')
  await step4.locator('input[name="lastname"]').fill('Administrator')
  await step4.locator('input[name="admin_email"]').fill('admin@clean.example.test')
  await step4.locator('input[name="step5"]').click()

  const step5 = page.locator('form[name="step5"]')
  await expect(step5).toBeVisible({ timeout: 60_000 })
  await waitForClickHandler(step5.locator('input[name="step6"]'))
  await expect(page.locator('.errorMessageContent')).toHaveCount(0)
  await step5.locator('input[name="step6"]').click()

  const step6 = page.locator('form[name="step6"]')
  await expect(step6).toBeVisible()
  await waitForClickHandler(step6.locator('input[name="step7"]'))
  await step6.locator('input[name="myname"]').fill('ModernUI clean stand')
  await step6.locator('input[name="myemail"]').fill('admin@clean.example.test')
  await step6.locator('select[name="industry"]').evaluate((select: HTMLSelectElement) => {
    const option = Array.from(select.options).find((item) => item.value !== '')
    if (option !== undefined) {
      select.value = option.value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await step6.locator('input[name="step7"]').click()

  // Step 7 creates the schema and installs the bundled modules, then signs the administrator in: the first sign-in
  // shows the feature selection (SystemSetup), completed later by signIn() of the scenarios.
  await page.waitForSelector('#navbar, #username, form#SystemSetup, form[action*="UserSetupSave"]', { timeout: 25 * 60_000 })
  expect(page.url().startsWith(crmUrl())).toBe(true)
  console.log(`[install ${target}] step 3 not-recommended values: ${JSON.stringify(failedChecks)}; dialogs: ${JSON.stringify(dialogs)}; blocked external requests: ${JSON.stringify(blocked)}`)
})
