/**
 * Stage 17 (docs/architecture.md §7.14): small presentation helpers for the remaining families of screens. The layout is
 * CSS over the original v7 nodes (skin/_cloud-special.scss); this scope only provides what CSS cannot read:
 * - calendar: the colour of each calendar (event type, user, group) lives in the inline style of its row and changes when
 *   the user picks another colour; it is copied to --mu-feed-color of the row's check box, which is drawn in that colour;
 * - dashboard: the width of "Add widget" of the active tab, so the tabs and "More" end before it (--mu-dashboard-add);
 * - find duplicates: the list tree of the module opens from the toolbar instead of being a permanent column.
 * Nothing here handles a business action, changes values or moves jQuery nodes; teardown restores the attributes.
 */
import type { IslandScope } from '../../boot/runtime'

export interface SpecialTexts {
  lists: string
  close: string
}

const FEED_COLOR = '--mu-feed-color'

function startCalendarColors(scope: IslandScope): void {
  const sidebar = document.querySelector<HTMLElement>('.main-container > #sidebar-essentials')
  if (sidebar === null || document.getElementById('CalendarViewContent') === null) return
  const painted = new Set<HTMLInputElement>()
  let frame: number | null = null
  const paint = (): void => {
    frame = null
    for (const row of sidebar.querySelectorAll<HTMLElement>('.feedslist > li.calendar-feed-indicator:not(.mass-edit-option)')) {
      const input = row.querySelector<HTMLInputElement>('input.toggleCalendarFeed')
      if (input === null) continue
      // The inline colour is the one the calendar draws its events with (set by the server or by Calendar_Calendar_Js).
      const colour = row.style.backgroundColor
      if (colour === '') {
        if (input.style.getPropertyValue(FEED_COLOR) !== '') input.style.removeProperty(FEED_COLOR)
        continue
      }
      if (input.style.getPropertyValue(FEED_COLOR) !== colour) input.style.setProperty(FEED_COLOR, colour)
      painted.add(input)
    }
  }
  const schedule = (): void => { frame ??= window.requestAnimationFrame(paint) }
  // The panel is loaded with AJAX and rows are added, recoloured and removed by v7.
  scope.observe(sidebar, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] }, (records) => {
    if (records.some((record) => !(record.target instanceof HTMLInputElement))) schedule()
  })
  paint()
  scope.onDispose(() => {
    if (frame !== null) window.cancelAnimationFrame(frame)
    for (const input of painted) input.style.removeProperty(FEED_COLOR)
  })
}

function startDashboard(scope: IslandScope): void {
  const container = document.querySelector<HTMLElement>('#page > .dashBoardContainer')
  if (container === null) return
  const html = document.documentElement
  let frame: number | null = null
  const measure = (): void => {
    frame = null
    const add = container.querySelector<HTMLElement>('.tab-pane.active .dashboardHeading .buttonGroups')
    const width = add === null ? 0 : Math.ceil(add.getBoundingClientRect().width)
    html.style.setProperty('--mu-dashboard-add', `${String(width)}px`)
  }
  const schedule = (): void => { frame ??= window.requestAnimationFrame(measure) }
  const resize = new ResizeObserver(schedule)
  resize.observe(container)
  // A tab is loaded with AJAX into its own pane; the active pane changes on a click on a tab.
  scope.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, schedule)
  scope.listen(window, 'resize', schedule, { passive: true })
  measure()
  scope.onDispose(() => {
    resize.disconnect()
    if (frame !== null) window.cancelAnimationFrame(frame)
    html.style.removeProperty('--mu-dashboard-add')
  })
}

function startDuplicates(scope: IslandScope, texts: SpecialTexts): void {
  const sidebar = document.getElementById('sidebar-essentials')
  const nav = document.querySelector('#page > nav.app-fixed-navbar')
  if (sidebar === null || nav === null || document.getElementById('findDuplicateContents') === null) return
  const html = document.documentElement
  const controls = document.createElement('div')
  controls.className = 'mu-list-controls'
  controls.setAttribute('data-mu-root', 'list-controls')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'mu-list-filter'
  button.setAttribute('aria-controls', sidebar.id)
  button.setAttribute('aria-expanded', 'false')
  const glyph = document.createElement('span')
  glyph.className = 'fa fa-filter'
  glyph.setAttribute('aria-hidden', 'true')
  const label = document.createElement('span')
  label.className = 'mu-list-filter-label'
  label.textContent = texts.lists
  const caret = document.createElement('span')
  caret.className = 'fa fa-angle-down'
  caret.setAttribute('aria-hidden', 'true')
  button.append(glyph, label, caret)
  controls.appendChild(button)
  nav.appendChild(controls)
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'mu-list-close'
  close.title = texts.close
  close.setAttribute('aria-label', texts.close)
  const cross = document.createElement('span')
  cross.className = 'fa fa-times'
  cross.setAttribute('aria-hidden', 'true')
  close.appendChild(cross)
  sidebar.prepend(close)
  const previous = { role: sidebar.getAttribute('role'), label: sidebar.getAttribute('aria-label') }
  sidebar.setAttribute('role', 'region')
  sidebar.setAttribute('aria-label', texts.lists)

  const toggle = (open: boolean, focus = false): void => {
    html.toggleAttribute('data-mu-list-filters', open)
    button.setAttribute('aria-expanded', String(open))
    if (open) (sidebar.querySelector<HTMLElement>('.search-list') ?? sidebar.querySelector<HTMLElement>('a[href]'))?.focus()
    else if (focus) button.focus()
  }
  scope.listen(button, 'click', () => { toggle(!html.hasAttribute('data-mu-list-filters')) })
  scope.listen(close, 'click', () => { toggle(false, true) })
  scope.listen(document, 'click', (event) => {
    if (!(event.target instanceof Node) || !html.hasAttribute('data-mu-list-filters')) return
    const inPopover = event.target instanceof Element && event.target.closest('.popover, .modal, .select2-drop') !== null
    if (!inPopover && !sidebar.contains(event.target) && !button.contains(event.target)) toggle(false)
  })
  scope.listen(document, 'keydown', (event) => {
    if (event instanceof KeyboardEvent && event.key === 'Escape' && !event.defaultPrevented && html.hasAttribute('data-mu-list-filters')) {
      toggle(false, true)
      event.preventDefault()
    }
  })
  scope.onDispose(() => {
    controls.remove()
    close.remove()
    html.removeAttribute('data-mu-list-filters')
    for (const [name, value] of [['role', previous.role], ['aria-label', previous.label]] as const) {
      if (value === null) sidebar.removeAttribute(name)
      else sidebar.setAttribute(name, value)
    }
  })
}

export function startSpecial(scope: IslandScope, texts: SpecialTexts): void {
  startCalendarColors(scope)
  startDashboard(scope)
  startDuplicates(scope, texts)
}
