import { expect, type Page } from '@playwright/test'
import { settle } from './records-support'
import { waitForShell } from './support'

/** Open through the real list link: native row decisions and ModernUI's Navigation API integration both run. */
export async function openCloudRecord(page: Page, module: string, id: string, query = ''): Promise<void> {
  await page.goto(`index.php?module=${module}&view=List&modernui=on${query}`)
  await waitForShell(page)
  const row = page.locator(`#listViewContent tr.listViewEntries[data-id="${id}"]`)
  await expect(row).toBeVisible()
  await row.locator('a[href*="view=Detail"]:not([href*="mode="])').filter({ visible: true }).first().click()
  await expect(page.locator('html')).toHaveAttribute('data-mu-record', id)
  await expect(page.locator('#overlayPageContent .mu-record-back')).toBeVisible()
  await settle(page)
}

/** The menu calls the original tab's click handler. Names come from this CRM, never from a fixed translation. */
export async function recordTab(page: Page, selector: string): Promise<void> {
  const tab = page.locator(`#overlayPageContent .related-tabs ${selector}`).first()
  const anchor = tab.locator('a').first()
  if (await anchor.isVisible()) {
    await anchor.click()
  } else {
    const label = await anchor.getAttribute('displaylabel') ?? (await anchor.innerText()).trim()
    await page.locator('.mu-record-tab-overflow > button').click()
    await page.locator('.mu-record-tab-menu').getByRole('button', { name: label, exact: true }).first().click()
  }
  await settle(page)
}

/** Native action IDs/URLs and authorised field values; no chrome, transient timestamps or duplicated API data. */
export async function recordContract(page: Page): Promise<{ actions: string[]; fields: string[]; items: string[] }> {
  return page.locator('.detailViewContainer').evaluate((root) => {
    const text = (node: Element): string => node.textContent.replace(/\s+/g, ' ').trim()
    return {
      actions: Array.from(root.querySelectorAll('.detailViewButtoncontainer .btn, .detailViewButtoncontainer .dropdown-menu a'))
        .map((node) => `${node.id}|${text(node)}|${node.getAttribute('onclick') ?? node.getAttribute('href') ?? ''}`),
      fields: Array.from(root.querySelectorAll('[id*="_detailView_fieldValue_"]'))
        .map((node) => `${node.id}|${text(node.querySelector('.value') ?? node)}|${node.getClientRects().length > 0 ? 'visible' : 'hidden'}`),
      items: Array.from(root.querySelectorAll('.lineItemsTable tr, #lineItemTab tr')).map(text),
    }
  })
}
