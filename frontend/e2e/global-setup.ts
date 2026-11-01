/**
 * Signs in once as the administrator of the instance and keeps the session for the tests (.local/, not in git).
 */
import { chromium } from '@playwright/test'
import { adminCredentials, crmUrl, stateFile } from './env'

export default async function globalSetup(): Promise<void> {
  const { user, password } = adminCredentials()
  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL: crmUrl() })
  await page.goto('index.php')
  await page.locator('#username').fill(user)
  await page.locator('#password').fill(password)
  await Promise.all([page.waitForURL(/index\.php/), page.locator('form.login-form button[type="submit"]').first().click()])
  await page.waitForSelector('#navbar', { timeout: 30_000 })
  await page.context().storageState({ path: stateFile })
  await browser.close()
}
