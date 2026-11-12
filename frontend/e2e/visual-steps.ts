/** Shared interactions for cloud pairs and accepted clean-instance visual regressions. */
import { expect, type Page } from '@playwright/test'
import { openListFilters, openListSearch, waitForShell } from './support'
import { recordTab } from './cloud-records-support'

/** Pages that accept the "leave the page?" question of an unsaved draft of the module's own pages (registered once). */
const acceptingDialogs = new WeakSet<Page>()

function acceptDialogs(page: Page): void {
  if (!acceptingDialogs.has(page)) {
    acceptingDialogs.add(page)
    page.on('dialog', (dialog) => {
      void dialog.accept()
    })
  }
}

export async function visualStep(page: Page, name: string): Promise<void> {
  if (name === 'all-records') {
    // Native filter IDs differ between installations. Clear the previous test's search through its own All link.
    const filter = await page.locator('.lists-menu a.filterName').filter({ hasText: /^(All|Все|Alle)$/ }).first().getAttribute('data-filter-id')
    expect(filter, 'native All filter').toBeTruthy()
    const url = new URL(page.url())
    url.searchParams.set('viewname', filter ?? '')
    url.searchParams.set('search_params', '[]')
    url.searchParams.set('page', '1')
    url.searchParams.set('modernui', 'on')
    await page.goto(url.href)
    await waitForShell(page)
  } else if (name.startsWith('mu-tab:')) {
    // Stage 16: a section of the page of ModernUI (the draft of the editor is never saved by these steps).
    acceptDialogs(page)
    await page.locator(`[data-mu-tab="${name.slice(7)}"]`).click()
    await expect(page.locator(`[data-mu-tab="${name.slice(7)}"][data-state="active"]`)).toBeVisible()
  } else if (name === 'mu-open-picker') {
    await page.locator('[data-mu-action="add-modules"]').click()
    await expect(page.locator('[data-mu-panel="add-modules"]')).toBeVisible()
  } else if (name === 'mu-open-confirm') {
    await page.locator('[data-mu-action="remove-group"]').click()
    await expect(page.locator('[data-mu-dialog="confirm"]')).toBeVisible()
  } else if (name === 'mu-prefs-favorite') {
    acceptDialogs(page)
    if ((await page.locator('[data-mu-list="favorites"] > li').count()) === 0) {
      const option = await page.locator('[data-mu-field="favorite"] option').nth(1).getAttribute('value')
      await page.locator('[data-mu-field="favorite"]').selectOption(option ?? '')
      await page.locator('[data-mu-action="add-favorite"]').click()
    }
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
  } else if (name === 'open-direct-record') {
    const href = await page.locator('#listViewContent tr.listViewEntries[data-id] a[href*="view=Detail"]:not([href*="mode="])').filter({ visible: true }).first().getAttribute('href')
    expect(href).toBeTruthy()
    const url = new URL(href ?? '', page.url())
    url.searchParams.set('modernui', 'on')
    await page.goto(url.href)
    await waitForShell(page)
    await page.locator('.related-tabs [data-link-key="LBL_RECORD_DETAILS"] a').click()
    await expect(page.locator('.mu-record-search input')).toBeVisible()
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
    await expect(page.locator('.mu-mega__no-results')).toBeVisible()
  } else if (name === 'user-menu') {
    await page.locator('#navbar a.userName').click()
    await expect(page.locator('#navbar .logout-content')).toBeVisible()
  } else if (name === 'global-search') {
    await page.locator('.search-link .keyword-input').click()
    await expect(page.locator('.search-link .keyword-input')).toBeFocused()
  } else if (name.startsWith('record-')) {
    const tabs: Record<string, string> = {
      'record-summary': '[data-link-key="LBL_RECORD_SUMMARY"]',
      'record-details': '[data-link-key="LBL_RECORD_DETAILS"]',
      'record-documents': '[data-module="Documents"]',
      'record-updates': '[data-label-key="LBL_UPDATES"]',
    }
    const selector = tabs[name]
    if (selector === undefined) throw new Error(`unknown step ${name}`)
    await recordTab(page, selector)
  } else if (name === 'open-edit') {
    await page.locator('.mu-record-actions-toggle').click()
    await page.locator('#overlayPageContent [id$="_detailView_basicAction_LBL_EDIT"]').click()
    await expect(page.locator('#overlayPageContent form#EditView')).toBeVisible()
  } else if (name === 'blur-field') {
    await page.locator('#overlayPageContent .overlayHeader').click()
  } else if (name === 'open-create') {
    await page.locator('[id$="_listView_basicAction_LBL_ADD_RECORD"]').click()
    await expect(page.locator('#overlayPageContent form#EditView')).toBeVisible()
  } else if (name === 'quick-create') {
    await page.locator('#menubar_quickCreate').click()
    await page.locator('#menubar_quickCreate_Accounts').click()
    await expect(page.locator('.mu-quick-form')).toBeVisible()
  } else if (name === 'required-error') {
    // The empty native required field prevents a POST; this visual scenario never creates a record.
    await expect(page.locator('#overlayPageContent [name="accountname"]')).toHaveValue('')
    await page.locator('#overlayPageContent .saveButton').click()
    await expect(page.locator('.mu-form-error').first()).toBeVisible()
  } else if (name === 'cancel-confirmation') {
    await page.locator('#overlayPageContent [name="accountname"]').fill('MU14 unsaved visual example')
    await page.locator('#overlayPageContent .cancelLink').click()
    await expect(page.locator('.bootbox')).toBeVisible()
  } else if (name === 'inventory-items') {
    await page.locator('.mu-form-sections button').last().click()
  } else if (name === 'settings-search' || name === 'settings-search-empty') {
    // The native search of the settings reacts to keys (instaFilta): type, do not fill. The term with matches is the start
    // of the label of the picklist editor in the language of this CRM (the cloud reference types "pick").
    const label = (await page.locator('.settingsgroup a.menuItemLabel[href*="module=Picklist&"]').first().textContent() ?? '').trim()
    const term = name === 'settings-search' ? label.slice(0, 4) : 'zzqq'
    expect(term.length, 'a term of the search').toBe(4)
    const search = page.locator('.settingsgroup #settingsMenuSearch')
    await search.click()
    await search.pressSequentially(term, { delay: 40 })
    // Characters outside the keyboard layout (Cyrillic) are inserted without key events; a key up runs the search.
    await search.press('End')
    await expect(name === 'settings-search' ? page.locator('.settingsgroup a.menuItemLabel[data-instafilta-hide="false"]').first() : page.locator('.mu-settings-empty')).toBeVisible()
  } else if (name === 'calendar-fixed-date') {
    await page.evaluate(() => {
      const jq = (window as unknown as { jQuery: (selector: string) => { fullCalendar: (...args: string[]) => void } }).jQuery
      jq('.calendarview').fullCalendar('gotoDate', '2026-01-15')
    })
  } else if (name.startsWith('fc-view:')) {
    // Stage 17: a view of the calendar by its own FullCalendar button (month, agendaWeek, agendaDay, vtAgendaList).
    await page.locator(`.calendarview .fc-${name.slice(8)}-button`).click()
    await expect(page.locator(`.calendarview .fc-${name.slice(8)}-button.fc-state-active`)).toBeVisible()
    await page.waitForLoadState('networkidle').catch(() => undefined)
  } else if (name === 'open-import') {
    // Import is the second half of the split Add button of the cloud list (stage 12).
    await page.locator('#appnav .mu-list-more').click()
    await page.locator('#appnav [id$="_basicAction_LBL_IMPORT"]').click()
    await expect(page.locator('#overlayPageContent .fc-overlay-modal')).toBeVisible()
  } else if (name === 'open-first-report') {
    // The first tabular (or summary) report of the list of this instance; chart reports have their own view.
    const href = await page.locator('#listview-table tr.listViewEntries[data-recordurl*="view=Detail"]').first().getAttribute('data-recordurl')
    expect(href, 'a tabular report on this instance').toBeTruthy()
    const url = new URL(href ?? '', page.url())
    url.searchParams.set('modernui', 'on')
    await page.goto(url.href)
    await waitForShell(page)
  } else if (name === 'calendar-add-event') {
    await page.locator('#calendarview_basicaction_addevent').click()
    await expect(page.locator('.mu-quick-form')).toBeVisible()
  } else if (name === 'export') {
    // The native export dialog of the list (the same call as its menu item); nothing is downloaded.
    await page.evaluate(() => { (window as unknown as { Vtiger_List_Js: { triggerExportAction(url: string): void } }).Vtiger_List_Js.triggerExportAction(`index.php?module=${new URL(location.href).searchParams.get('module') ?? ''}&view=Export`) })
    await expect(page.locator('#overlayPageContent .fc-overlay-modal, .modal.in').first()).toBeVisible()
  } else if (name === 'select-two') {
    for (const box of (await page.locator('#listview-table .listViewEntriesCheckBox').all()).slice(0, 2)) await box.check()
  } else if (name === 'mass-edit') {
    await page.locator('#listview-actions [id$="_listView_massAction_LBL_EDIT"]').click()
    await expect(page.locator('#overlayPageContent .fc-overlay-modal, .modal.in').first()).toBeVisible()
  } else if (name === 'task-management') {
    await page.locator('.global-nav .taskManagement').first().click()
    await expect(page.locator('#overlayPage #taskManagementContainer')).toBeVisible()
  } else if (name === 'import-csv') {
    await page.locator('#overlayPageContent #csvImport .menu-item').click()
    await expect(page.locator('#overlayPageContent #importContainer')).toBeVisible()
  } else if (name === 'report-conditions') {
    // The button toggles the conditions; a report with conditions opens with them shown.
    if (!(await page.locator('#filterContainer').isVisible())) await page.locator('button[name="modify_condition"]').click()
    await expect(page.locator('#filterContainer')).toBeVisible()
  } else if (name === 'dashboard-widgets') {
    // A tab of the dashboard with widgets (a fresh CRM opens an empty personal tab): switch tabs, nothing is added.
    const tabs = page.locator('.dashBoardContainer .nav-tabs li.dashboardTab > a')
    for (let index = 0; index < await tabs.count(); index++) {
      if (await page.locator('.tab-pane.active .dashboardWidget').count() > 0) break
      await tabs.nth(index).click()
      await page.waitForTimeout(2500)
    }
    await expect(page.locator('.tab-pane.active .dashboardWidget').first()).toBeVisible()
  } else if (name === 'dashboard-add-widget') {
    await page.locator('.tab-pane.active .dashboardHeading .addButton.dropdown-toggle').click()
    await expect(page.locator('.tab-pane.active .dashboardHeading .dropdown-menu')).toBeVisible()
  } else if (name === 'open-mass-select') {
    await page.locator('#listview-table .listViewEntriesCheckBox').first().check()
  } else if (name === 'picklist-add') {
    await page.locator('#addItem').click()
    await expect(page.locator('.modal.in .modal-footer')).toBeVisible()
  } else {
    throw new Error(`unknown step ${name}`)
  }
  await page.waitForTimeout(800)
}
