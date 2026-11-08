/**
 * The system settings of v7 in the cloud layout of the settings (V09, docs/design.md §13.11, docs/architecture.md §7.12).
 *
 * The layout is CSS over the original nodes (skin/_cloud-settings.scss, the header in skin/_shell.scss): the start page is
 * the catalog of the settings made of the side navigation of v7 — the server prints there exactly the items this
 * administrator may open, extensions included, with their translated labels and URLs — and the native search of the
 * settings (instaFilta of v7) filters it. This adapter adds only what CSS cannot know:
 *
 * - the page of the CRM the user came from, for "← Back to CRM" (sessionStorage of the tab, a CRM link only);
 * - an own, translated "no matches" message next to the native search (the search itself, its matching and the hidden
 *   items stay v7's).
 *
 * Everything is registered in the scope it gets and is undone when the scope is disposed (standard view, failed shell).
 */
import type { IslandScope } from '../../boot/runtime'
import { crmLink } from './page'

const RETURN_KEY = 'mu:crm-return'
const HOME = 'index.php'

/** A page of the system settings: the side navigation of the settings of v7 (admin) or of the user preferences. */
export function isSettingsPage(root: ParentNode = document): boolean {
  return root.querySelector('#page > .main-container > #modnavigator.settingsNav') !== null
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * Remembers the current page of the CRM (not of the settings) as the target of "Back to CRM". Only a link of the CRM itself
 * (index.php?… of this installation) is kept; the tab's session storage is per tab and per user session.
 */
export function rememberCrmPage(location: Pick<Location, 'href'> = window.location): void {
  if (isSettingsPage()) {
    return
  }
  const link = crmLink(location.href)
  if (link === null || /(?:^|[?&])parent=Settings(?:&|$)/.test(link)) {
    return
  }
  try {
    storage()?.setItem(RETURN_KEY, link)
  } catch {
    // Storage full or blocked: the link falls back to the home page of the CRM.
  }
}

/** Where "Back to CRM" leads: the last page of the CRM in this tab, else the home page. Always a link of this CRM. */
export function crmReturnUrl(): string {
  let stored: string | null = null
  try {
    stored = storage()?.getItem(RETURN_KEY) ?? null
  } catch {
    stored = null
  }
  const link = crmLink(stored)
  return link !== null && !/(?:^|[?&])parent=Settings(?:&|$)/.test(link) ? link : HOME
}

/** Own "no matches" message of the native settings search; shown by CSS while the search hides every group. */
export function startSettings(scope: IslandScope, texts: { empty: string; emptyHint: string }): void {
  if (!isSettingsPage()) {
    return
  }
  for (const group of document.querySelectorAll<HTMLElement>('#modnavigator.settingsNav .settingsgroup')) {
    if (group.querySelector('#settingsMenuSearch') === null || group.querySelector(':scope > .mu-settings-empty') !== null) {
      continue
    }
    const empty = document.createElement('div')
    empty.className = 'mu-settings-empty'
    empty.setAttribute('role', 'status')
    const title = document.createElement('p')
    title.className = 'mu-settings-empty__title'
    title.textContent = texts.empty
    const hint = document.createElement('p')
    hint.className = 'mu-settings-empty__hint'
    hint.textContent = texts.emptyHint
    empty.append(title, hint)
    group.appendChild(empty)
    scope.onDispose(() => {
      empty.remove()
    })
  }
  // On the start page the groups of the accordion are the headings of the catalog (open, not toggles): their links leave
  // the order of Tab, so the key goes from the search to the settings themselves.
  if (document.querySelector('#page > .main-container > .settingsPageDiv > .settingsIndexPage') !== null) {
    for (const toggle of document.querySelectorAll<HTMLElement>('#modnavigator.settingsNav .settingsgroup-accordion > a')) {
      const previous = toggle.getAttribute('tabindex')
      toggle.setAttribute('tabindex', '-1')
      scope.onDispose(() => {
        if (previous === null) {
          toggle.removeAttribute('tabindex')
        } else {
          toggle.setAttribute('tabindex', previous)
        }
      })
    }
  }
}
