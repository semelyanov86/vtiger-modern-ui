/**
 * Cloud list composition around the ORIGINAL v7 list (design.md §13.8). CSS lays out the existing action bar,
 * module buttons, table and sidebar. This scope owns only disclosure buttons and presentation attributes. It never
 * copies rows, changes list parameters, moves jQuery nodes or handles a business action. List.js remains responsible
 * for filters, selection, search, pagination, columns, tags and extension actions, including after AJAX replacement.
 */
import type { IslandScope } from '../../boot/runtime'

export interface ListTexts {
  filters: string
  search: string
  more: string
  close: string
}

export function startLists(scope: IslandScope, texts: ListTexts): void {
  const html = document.documentElement
  const content = document.querySelector<HTMLElement>('#listViewContent.listViewPageDiv')
  const nav = document.querySelector('#page > nav.app-fixed-navbar')
  if (content === null || nav === null || document.querySelector('#view[value="List"]') === null
    || content.querySelector('#listview-actions .listViewActionsContainer') === null
    || content.querySelector('#listview-actions #table-content') !== null) {
    return
  }
  const sidebar = document.getElementById('sidebar-essentials')
  const controls = document.createElement('div')
  controls.className = 'mu-list-controls'
  controls.setAttribute('data-mu-root', 'list-controls')
  nav.appendChild(controls)

  const button = (name: string, icon: string, label: string): HTMLButtonElement => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = `mu-list-${name}`
    element.title = label
    element.setAttribute('aria-label', label)
    element.setAttribute('aria-expanded', 'false')
    const glyph = document.createElement('span')
    glyph.className = `fa fa-${icon}`
    glyph.setAttribute('aria-hidden', 'true')
    element.appendChild(glyph)
    return element
  }
  const filter = button('filter', 'filter', texts.filters)
  const label = document.createElement('span')
  label.className = 'mu-list-filter-label'
  filter.appendChild(label)
  const caret = document.createElement('span')
  caret.className = 'fa fa-angle-down'
  caret.setAttribute('aria-hidden', 'true')
  filter.appendChild(caret)
  if (sidebar !== null) {
    filter.setAttribute('aria-controls', sidebar.id)
    controls.appendChild(filter)
  }
  const search = button('search', 'search', texts.search)
  controls.appendChild(search)

  const changed = new Map<Element, Map<string, string | null>>()
  const attribute = (element: Element, name: string, value: string): void => {
    let previous = changed.get(element)
    if (previous === undefined) {
      previous = new Map()
      changed.set(element, previous)
    }
    if (!previous.has(name)) previous.set(name, element.getAttribute(name))
    if (element.getAttribute(name) !== value) element.setAttribute(name, value)
  }

  let frame: number | null = null
  const schedule = (): void => { frame ??= window.requestAnimationFrame(refresh) }
  const disclosure = (name: string, trigger: HTMLButtonElement, open: boolean): void => {
    html.toggleAttribute(`data-mu-list-${name}`, open)
    trigger.setAttribute('aria-expanded', String(open))
    schedule()
  }
  const closeFilters = (focus = false): void => {
    disclosure('filters', filter, false)
    if (focus) filter.focus()
  }
  if (sidebar !== null) {
    attribute(sidebar, 'role', 'region')
    attribute(sidebar, 'aria-label', texts.filters)
    const close = button('close', 'times', texts.close)
    close.removeAttribute('aria-expanded')
    sidebar.prepend(close)
    scope.listen(close, 'click', () => { closeFilters(true) })
    scope.onDispose(() => { close.remove() })
    scope.listen(filter, 'click', () => {
      const open = !html.hasAttribute('data-mu-list-filters')
      disclosure('filters', filter, open)
      if (open) (sidebar.querySelector<HTMLElement>('.search-list, .search-folders') ?? sidebar.querySelector<HTMLElement>('a[href]'))?.focus()
    })
    // Let the native click handler read the original link and change the URL before closing the panel.
    scope.listen(sidebar, 'click', (event) => {
      if (event.target instanceof Element && event.target.closest('a.filterName, .module-extensions a, .tagLabel') !== null) {
        closeFilters()
      }
    })
  }
  scope.listen(search, 'click', () => {
    const open = !html.hasAttribute('data-mu-list-search')
    disclosure('search', search, open)
    if (open) content.querySelector<HTMLElement>('.searchRow input:not([type="hidden"]), .searchRow select')?.focus()
    // floatThead owns the original thead; its resize handler recalculates the spacer after the row opens/closes.
    window.dispatchEvent(new Event('resize'))
  })

  // Import is the second half of Add. Its original <li>, button, onclick and ancestors stay intact. Additional
  // extension buttons and the native Customize dropdown remain in the toolbar; no guessed SaaS views are added.
  const add = nav.querySelector<HTMLElement>('#appnav button[id$="_listView_basicAction_LBL_ADD_RECORD"]')
  const importItem = nav.querySelector<HTMLElement>('#appnav button[id$="_basicAction_LBL_IMPORT"]')?.closest('li') ?? null
  let split: HTMLButtonElement | null = null
  if (add !== null && importItem !== null) {
    split = button('more', 'angle-down', texts.more)
    attribute(add, 'data-mu-list-add', '')
    attribute(importItem, 'data-mu-list-import', '')
    if (importItem.id === '') attribute(importItem, 'id', 'mu-list-import')
    split.setAttribute('aria-controls', importItem.id)
    add.after(split)
    const trigger = split
    scope.listen(trigger, 'click', () => {
      const open = !html.hasAttribute('data-mu-list-more')
      disclosure('more', trigger, open)
      if (open) importItem.querySelector<HTMLElement>('button')?.focus()
    })
    scope.listen(importItem, 'click', () => { disclosure('more', trigger, false) })
    scope.onDispose(() => { trigger.remove() })
  }
  scope.listen(document, 'click', (event) => {
    if (!(event.target instanceof Node)) return
    // Native popovers for filter settings and tags may be attached to body.
    const inPopover = event.target instanceof Element && event.target.closest('.popover, .modal, .select2-drop') !== null
    if (!inPopover && !sidebar?.contains(event.target) && !filter.contains(event.target)) closeFilters()
    if (split !== null && !split.contains(event.target) && !importItem?.contains(event.target)) disclosure('more', split, false)
  })
  scope.listen(document, 'keydown', (event) => {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Escape' || event.defaultPrevented) return
    if (html.hasAttribute('data-mu-list-more') && split !== null) {
      disclosure('more', split, false)
      split.focus()
      event.preventDefault()
    } else if (html.hasAttribute('data-mu-list-filters')) {
      closeFilters(true)
      event.preventDefault()
    }
  })

  const refresh = (): void => {
    frame = null
    const active = sidebar?.querySelector('.tag.active .tagLabel') ?? sidebar?.querySelector('.listViewFilter.active .filterName, .lists-menu .active a')
    const name = active?.getAttribute('title') ?? active?.textContent.trim() ?? texts.filters
    if (label.textContent !== name) label.textContent = name
    filter.title = `${texts.filters}: ${name}`
    search.hidden = content.querySelector('.searchRow') === null

    const tail = content.querySelector<HTMLElement>('#listview-actions')
    if (tail !== null) {
      html.style.setProperty('--mu-list-tail', `${String(Math.ceil(tail.getBoundingClientRect().width))}px`)
    }
    // Full accessible text stays in the DOM and in the native title. Only static values are clipped; edit widgets are
    // not touched. A cell without a native title gains one, undone on teardown.
    for (const cell of content.querySelectorAll<HTMLElement>('td.listViewEntryValue:not([title])')) {
      attribute(cell, 'title', cell.textContent.trim())
    }
    // Keyboard equivalents for the non-semantic controls of v7 (native handlers still receive their click).
    for (const control of document.querySelectorAll<HTMLElement>('#sidebar-essentials [data-toggle="popover"], #listViewContent .listColumnFilter:not(.disabled), #listViewContent .table-actions span[data-toggle="dropdown"]')) {
      attribute(control, 'tabindex', '0')
      attribute(control, 'role', 'button')
      const title = control.getAttribute('title')
      if (title !== null) attribute(control, 'aria-label', title)
    }
    // Extension output before the native action bar is a separate summary region. No module names or business fields.
    const parent = tail?.parentElement
    if (parent !== null && parent !== undefined) {
      for (const child of parent.children) {
        if (child === tail) break
        if (child instanceof HTMLElement && !['INPUT', 'SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)
          && !child.classList.contains('essentials-toggle') && child.getBoundingClientRect().height > 0) {
          attribute(child, 'data-mu-list-summary', '')
          // Optional summary cards: preserve links, numbers and the original status colour as an accent.
          for (const card of child.querySelectorAll<HTMLElement>('div:has(> a[href]):has(> dd)')) {
            if (!card.hasAttribute('data-mu-list-counter')) {
              const color = getComputedStyle(card).backgroundColor
              attribute(card, 'style', `${card.getAttribute('style') ?? ''};--mu-summary-accent:${color}`)
              attribute(card, 'data-mu-list-counter', '')
              if (card.parentElement !== null) attribute(card.parentElement, 'data-mu-list-counters', '')
            }
          }
        }
      }
    }
  }
  scope.listen(document, 'keydown', (event) => {
    if (event instanceof KeyboardEvent && ['Enter', ' '].includes(event.key)
      && event.target instanceof HTMLElement && changed.has(event.target) && event.target.getAttribute('role') === 'button') {
      event.preventDefault()
      event.target.click()
    }
  })
  scope.observe(content, { childList: true, subtree: true }, schedule)
  if (sidebar !== null) scope.observe(sidebar, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, schedule)
  scope.onAppEvent('post.listViewFilter.click', schedule)
  scope.onAppEvent('Post.ListRow.Checked', schedule)
  scope.onAppEvent('Post.ListRow.UnChecked', schedule)
  scope.listen(content, 'change', schedule)
  scope.listen(window, 'resize', schedule, { passive: true })
  html.setAttribute('data-mu-lists', '')
  // Existing searches must remain visible after reload/Back, including filters restored from the server session.
  const searchParams = content.querySelector<HTMLInputElement>('#currentSearchParams')?.value ?? ''
  if (searchParams !== '' && searchParams !== '[]' && searchParams !== '[[]]') disclosure('search', search, true)
  refresh()
  window.dispatchEvent(new Event('resize'))
  scope.onDispose(() => {
    if (frame !== null) window.cancelAnimationFrame(frame)
    controls.remove()
    for (const [element, attributes] of changed) {
      for (const [name, value] of attributes) {
        if (value === null) element.removeAttribute(name)
        else element.setAttribute(name, value)
      }
    }
    for (const name of ['lists', 'list-filters', 'list-search', 'list-more']) html.removeAttribute(`data-mu-${name}`)
    html.style.removeProperty('--mu-list-tail')
    window.dispatchEvent(new Event('resize'))
  })
}
