// @vitest-environment happy-dom
/**
 * The system settings (src/adapters/v7/settings.ts, docs/architecture.md §7.12): the page of the CRM "Back to CRM" leads to
 * (only a link of this CRM, never a page of the settings, the home page without one), the own "no matches" message and
 * the keyboard order of the catalog, undone with the scope.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { crmReturnUrl, isSettingsPage, rememberCrmPage, startSettings } from '../src/adapters/v7/settings'
import { createScope } from '../src/boot/runtime'

const texts = { empty: 'No matches found', emptyHint: 'Change the search' }

function settingsPage(home: boolean): void {
  document.body.innerHTML = `
    <div id="page">
      <div class="main-container">
        <div id="modnavigator" class="module-nav settingsNav">
          <div class="settingsgroup">
            <div><input id="settingsMenuSearch" class="search-list"></div>
            <div class="panel-group">
              <div class="settingsgroup-panel instaSearch">
                <div class="app-nav"><div class="app-settings-accordion"><div class="settingsgroup-accordion">
                  <a data-toggle="collapse" href="#LBL_USER_MANAGEMENT"><span>User Management</span></a>
                </div></div></div>
                <ul><li><a class="menuItemLabel" href="index.php?module=Users&parent=Settings&view=List">Users</a></li></ul>
              </div>
            </div>
          </div>
        </div>
        <div class="settingsPageDiv">${home ? '<div class="settingsIndexPage"></div>' : ''}</div>
      </div>
    </div>`
}

beforeEach(() => {
  window.sessionStorage.clear()
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Back to CRM', () => {
  it('remembers a page of the CRM and leads back to it', () => {
    rememberCrmPage({ href: new URL('index.php?module=Accounts&view=List&viewname=5', document.baseURI).href })
    expect(crmReturnUrl()).toBe('index.php?module=Accounts&view=List&viewname=5')
  })

  it('never remembers a page of the settings or another site, and falls back to the home page', () => {
    expect(crmReturnUrl()).toBe('index.php')
    rememberCrmPage({ href: new URL('index.php?module=Users&parent=Settings&view=List', document.baseURI).href })
    expect(crmReturnUrl()).toBe('index.php')
    rememberCrmPage({ href: 'https://example.org/index.php?module=Accounts&view=List' })
    expect(crmReturnUrl()).toBe('index.php')
    window.sessionStorage.setItem('mu:crm-return', 'javascript:alert(1)')
    expect(crmReturnUrl()).toBe('index.php')
  })

  it('does not remember anything on a page of the settings', () => {
    settingsPage(false)
    expect(isSettingsPage()).toBe(true)
    rememberCrmPage({ href: new URL('index.php?module=Accounts&view=List', document.baseURI).href })
    expect(crmReturnUrl()).toBe('index.php')
  })
})

describe('search and keyboard of the settings', () => {
  it('adds the own empty message once and removes it with the scope', () => {
    settingsPage(false)
    const scope = createScope('settings')
    startSettings(scope, texts)
    startSettings(scope, texts)
    const empty = document.querySelectorAll('.settingsgroup > .mu-settings-empty')
    expect(empty).toHaveLength(1)
    expect(empty[0]?.getAttribute('role')).toBe('status')
    expect(empty[0]?.textContent).toContain('No matches found')
    expect(document.querySelector('.settingsgroup-accordion > a')?.hasAttribute('tabindex')).toBe(false)
    scope.dispose()
    expect(document.querySelector('.mu-settings-empty')).toBeNull()
  })

  it('takes the headings of the catalog out of the Tab order on the start page only, and gives it back', () => {
    settingsPage(true)
    const scope = createScope('settings')
    startSettings(scope, texts)
    expect(document.querySelector('.settingsgroup-accordion > a')?.getAttribute('tabindex')).toBe('-1')
    scope.dispose()
    expect(document.querySelector('.settingsgroup-accordion > a')?.hasAttribute('tabindex')).toBe(false)
  })

  it('does nothing outside the settings', () => {
    document.body.innerHTML = '<div id="page"><div class="main-container"><div id="listViewContent"></div></div></div>'
    const scope = createScope('settings')
    startSettings(scope, texts)
    expect(document.querySelector('.mu-settings-empty')).toBeNull()
    scope.dispose()
  })
})
