/**
 * Header buttons of a record. The core decides where an action belongs: DETAILVIEWBASIC links are rendered as buttons
 * of the header, DETAILVIEW links go to its "More" dropdown. The theme keeps that decision — the basic buttons stay in
 * the header as the same native nodes (handlers, ids and order unchanged); only those that do not fit are folded into
 * the record's actions menu, from the end of the native order.
 */
import type { IslandScope } from '../boot/runtime'

/** The header buttons of DETAILVIEWBASIC links (core Vtiger/DetailViewActions.tpl). */
export const BASIC_ACTION = 'button[id*="_detailView_basicAction_"]'
/** Marks a basic button that did not fit; CSS hides it in the header and lists it in the actions menu. */
export const FOLDED = 'data-mu-folded'
/** Marks a header button kept at its header place while the actions menu (the same native toolbar) is open. */
export const PINNED = 'data-mu-pinned'
/** The title keeps at least this width before buttons are folded (less if its text is shorter or the row is narrow). */
const TITLE_MIN = 240
const BUTTON_GAP = 8
const ROW_GAP = 12

/**
 * How many leading buttons fit into the available width; the rest are folded. Zero-width (natively hidden) buttons
 * cost nothing and never break the order.
 */
export function visibleCount(widths: readonly number[], available: number, gap = BUTTON_GAP): number {
  let used = 0
  for (const [index, width] of widths.entries()) {
    if (width <= 0) continue
    used += (used > 0 ? gap : 0) + width
    if (used > available) return index
  }
  return widths.length
}

/** Space left for the buttons in a header row of rowWidth next to a title whose content is titleWidth wide. */
export function availableWidth(rowWidth: number, titleWidth: number): number {
  const title = Math.min(titleWidth, TITLE_MIN, rowWidth * 0.4)
  return Math.max(0, rowWidth - ROW_GAP - title)
}

/** Drawn width of the record name: the text itself, not its (stretched or clipped) block. */
function titleWidth(header: HTMLElement): number {
  const label = header.querySelector<HTMLElement>('.recordLabel')
  const image = header.querySelector<HTMLElement>('.recordImage')
  let width = 0
  if (label !== null) {
    const range = document.createRange()
    range.selectNodeContents(label)
    width = range.getBoundingClientRect().width
  }
  const icon = image?.getBoundingClientRect().width ?? 0
  return width + (icon > 0 ? icon + 8 : 0)
}

/**
 * Keeps the basic buttons of the header that fit and folds the others. Returns the re-fit callback (call it when the
 * actions menu closes; while it is open the toolbar is the menu panel and is not measured).
 */
export function fitHeaderActions(scope: IslandScope, header: HTMLElement, isOpen: () => boolean): () => void {
  const buttons = (): HTMLElement[] => Array.from(header.querySelectorAll<HTMLElement>(`.detailViewButtoncontainer ${BASIC_ACTION}`))
  let last = ''
  let disposed = false
  const fit = (): void => {
    const row = header.querySelector<HTMLElement>(':scope > .row')
    if (disposed || row === null || isOpen()) return
    const list = buttons()
    const title = titleWidth(header)
    // Measuring needs every button unfolded; skip that reflow when nothing that decides the result has changed.
    const key = [row.clientWidth, Math.round(title), ...list.map((button) => `${button.id}:${button.textContent.trim()}`)].join('|')
    if (key === last) return
    last = key
    list.forEach((button) => { button.removeAttribute(FOLDED) })
    const shown = visibleCount(list.map((button) => button.getBoundingClientRect().width), availableWidth(row.clientWidth, title))
    list.slice(shown).forEach((button) => { button.setAttribute(FOLDED, '') })
  }
  const resize = new ResizeObserver(fit)
  resize.observe(header)
  // Header buttons and the record name can be re-rendered by native scripts (inline edit of the name, extensions).
  scope.observe(header, { childList: true, subtree: true, characterData: true }, fit)
  void document.fonts.ready.then(() => { last = ''; fit() })
  scope.onDispose(() => {
    disposed = true
    resize.disconnect()
    buttons().forEach((button) => { button.removeAttribute(FOLDED) })
  })
  fit()
  return () => { last = ''; fit() }
}

/**
 * While the actions menu is open its panel is the native toolbar, which also holds the header buttons. Measure them
 * before the panel opens, then keep them where they were (absolute, outside the panel's scrolling list) and keep the
 * toolbar's width in the row, so neither the buttons nor the record name move. Returns the function releasing them.
 */
export function holdHeaderActions(header: HTMLElement, openPanel: () => void): () => void {
  const container = header.querySelector<HTMLElement>('.detailViewButtoncontainer')
  const toolbar = container?.querySelector<HTMLElement>(':scope > .btn-toolbar') ?? null
  const shown = toolbar === null ? [] : Array.from(toolbar.querySelectorAll<HTMLElement>(`:scope > .btn-group > ${BASIC_ACTION}:not([${FOLDED}])`))
    .filter((button) => button.getClientRects().length > 0)
  const places = shown.map((button) => button.getBoundingClientRect())
  if (container !== null && shown.length > 0) header.style.setProperty('--mu-actions-width', `${String(container.getBoundingClientRect().width)}px`)
  openPanel()
  const styles = new Map<HTMLElement, string | null>()
  if (toolbar !== null && shown.length > 0) {
    const panel = toolbar.getBoundingClientRect()
    shown.forEach((button, index) => {
      const place = places[index]
      if (place === undefined) return
      styles.set(button, button.getAttribute('style'))
      button.style.setProperty('--mu-pin-x', `${String(place.left - panel.left - toolbar.clientLeft)}px`)
      button.style.setProperty('--mu-pin-y', `${String(place.top - panel.top - toolbar.clientTop)}px`)
      button.setAttribute(PINNED, '')
    })
  }
  return () => {
    for (const [button, style] of styles) {
      button.removeAttribute(PINNED)
      if (style === null) button.removeAttribute('style')
      else button.setAttribute('style', style)
    }
    header.style.removeProperty('--mu-actions-width')
  }
}
