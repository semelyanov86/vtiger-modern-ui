/**
 * The header of v7 in the cloud layout (docs/design.md §13.7, docs/architecture.md §7.8). The layout itself is CSS
 * (skin/_shell.scss); this adapter adds what CSS cannot know, without changing the v7 elements otherwise:
 *
 * - the initials of the user for the round avatar (data-mu-initials on the v7 user link, removed again on teardown);
 * - Escape leaves the global search of v7 (the field closes back into its button; v7 itself has no key for it);
 * - the room the actions on the right take, so the title of the module in the same row ends before them
 *   (--mu-shell-actions on <html>, recomputed when the row resizes or an extension adds an icon later).
 *
 * Everything is registered in the scope it gets and is undone when the scope is disposed (standard view, failed shell).
 */
import { isRecord } from '../../api/guards'
import type { IslandScope } from '../../boot/runtime'

const ACTIONS_VARIABLE = '--mu-shell-actions'
/** Gap between the end of the title and the first action. */
const TITLE_GAP = 16

/** Two letters for an avatar: the first letters of the first two words, or the first two letters of a single word. */
export function initials(label: string): string {
  const words = label
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
  const first = words[0] ?? ''
  const second = words[1] ?? ''
  const letters = second !== '' ? `${first.slice(0, 1)}${second.slice(0, 1)}` : Array.from(first).slice(0, 2).join('')
  return letters.toLocaleUpperCase()
}

/** Name of the current user: _USERMETA.userlabel of Header.tpl, else the name in the user menu of the header. */
export function userLabel(): string {
  const meta = window._USERMETA
  const label = isRecord(meta) && typeof meta['userlabel'] === 'string' ? meta['userlabel'] : ''
  if (label.trim() !== '') {
    return label.trim()
  }
  return (document.querySelector('#navbar .logout-content .profile-container h4')?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function startHeader(scope: IslandScope): void {
  const html = document.documentElement
  const nav = document.querySelector('#page > nav.app-fixed-navbar')
  if (nav === null) {
    return
  }

  const user = nav.querySelector<HTMLElement>('#navbar a.userName')
  const letters = initials(userLabel())
  if (user !== null && letters !== '') {
    user.setAttribute('data-mu-initials', letters)
    scope.onDispose(() => {
      user.removeAttribute('data-mu-initials')
    })
  }

  const search = nav.querySelector<HTMLInputElement>('.search-link .keyword-input')
  if (search !== null) {
    scope.listen(search, 'keydown', (event) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape' && !event.defaultPrevented) {
        search.blur()
      }
    })
  }

  const row = nav.querySelector<HTMLElement>(':scope > .global-nav > .row')
  if (row === null) {
    return
  }
  const searchBox = row.querySelector<HTMLElement>(':scope > :has(> .search-links-container)')
  let frame: number | null = null
  const measure = (): void => {
    frame = null
    // An open search covers the title on purpose; the room of the closed one counts.
    if (searchBox?.matches(':focus-within') === true) {
      return
    }
    const items = [
      ...(searchBox !== null ? [searchBox] : []),
      ...row.querySelectorAll<HTMLElement>('#navbar > .navbar-nav > li, #navbar > [data-mu-root], .logo-container'),
    ]
    let left = Number.POSITIVE_INFINITY
    for (const item of items) {
      const box = item.getBoundingClientRect()
      if (box.width > 0 && box.left < left) {
        left = box.left
      }
    }
    if (Number.isFinite(left)) {
      const room = Math.max(0, Math.ceil(html.clientWidth - left + TITLE_GAP))
      html.style.setProperty(ACTIONS_VARIABLE, `${String(room)}px`)
    }
  }
  const schedule = (): void => {
    frame ??= window.requestAnimationFrame(measure)
  }
  scope.onDispose(() => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame)
    }
    html.style.removeProperty(ACTIONS_VARIABLE)
  })
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(schedule)
    observer.observe(row)
    scope.onDispose(() => {
      observer.disconnect()
    })
  }
  const navbar = row.querySelector('#navbar')
  if (navbar !== null) {
    scope.observe(navbar, { childList: true, subtree: true }, schedule)
  }
  if (searchBox !== null) {
    scope.listen(searchBox, 'focusout', schedule)
  }
  scope.listen(window, 'resize', schedule, { passive: true })
  schedule()
}
