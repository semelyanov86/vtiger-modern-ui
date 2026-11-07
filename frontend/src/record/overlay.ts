/**
 * The cloud record over the list (stage 13, docs/architecture.md A15; V05/V06 of docs/visual-parity.md).
 *
 * On the list screen of a module of layout.modules, the navigation of v7 to a record of the list (List.js opens
 * index.php?module=…&view=Detail&record=… after its own checks: not the checkbox column, no selected text, no row in inline
 * edit, no double click) is cancelled through the Navigation API and the same record is opened in the page overlay of v7
 * with a composition of the native Detail view: the list page — its filter, page, search, sort, selection and scroll — stays
 * as it is under the overlay. The decision when to navigate stays with v7 and its extensions; ModernUI only replaces the
 * full page load by the overlay.
 *
 * - The record: ModernUI Record composes native header, tabs and contents with the full Detail controller. Summary,
 *   Details and related data keep their original handlers. Direct Detail URLs remain available in a separate tab.
 * - Edit: OverlayEditView of the core (form#EditView, Vtiger_Edit_Js in overlay mode, post.overLayEditView.loaded for the
 *   extensions). The submit that v7 (validation, pre-save event) and extensions let through is a navigation: it is cancelled
 *   and the same form data (FormData of the navigation) go to the same action (Save) by app.request, so the user stays over
 *   the list and sees the record again.
 *   Errors of the server go to post.save.failed as in v7. Cancel and the close button are those of v7 (with its question
 *   about unsaved changes) and close the overlay.
 * - History: opening adds an entry (same URL, state muRecord); Back closes the overlay, Forward and a reload of the page
 *   open the record again. Escape closes the record; in the form it acts as Cancel; popups of v7 over it keep their Escape.
 * - After a save the list reloads its current page through the list controller of v7 (loadListViewRecords) when the
 *   overlay closes; the scroll position and the focus are restored.
 * - Handlers that the record view of v7 adds to persistent elements (event bus, other modals, the overlay) are removed when
 *   the view goes, window.onbeforeunload of the form is restored: opening many records does not pile anything up.
 * - Anything unexpected (a script or request of v7 fails, a handler is missing) closes the overlay and opens the full page
 *   of the record: the record stays reachable exactly as without the theme. Without the Navigation API nothing is
 *   intercepted at all.
 */
import type { IslandScope } from '../boot/runtime'
import { createScope } from '../boot/runtime'
import { presentRecord, type RecordTexts } from './presentation'
import {
  $, ensureRecordScripts, ensureDetailDependencies, installRecordMeta, handlerCount, hidePageOverlay, hideProgress, notifyError, onJQuery, release, reloadList, request, resetRowTimers,
  showPageOverlay, startCloudDetail, startEdit, tracked, trackedFocus, trigger, urlParams, withCsrf, type AddedHandler,
} from '../adapters/v7/record'
import { recordTarget, recordUrl, stateRecord, withRecord, type RecordTarget } from './target'

type State = 'closed' | 'opening' | 'detail' | 'edit'

export interface RecordOverlayTexts extends RecordTexts {
  /** Shown before the full page opens instead of the overlay. */
  readonly fallback: string
}

/** Attribute on <html> while a record is shown over the list (CSS of the overlay, checks of the e2e scenarios). */
export const RECORD_ATTRIBUTE = 'data-mu-record'
export const OVERLAY_CLASS = 'mu-record-overlay'

/** Popups of v7 over the overlay that own Escape (nested modal, Select2, date picker, popover, confirmation). */
const NESTED_POPUP = [
  '.modal.in:not(#overlayPageContent)', '.select2-drop-active', '.select2-container--open', '.ui-datepicker:visible',
  '.datepicker.dropdown-menu:visible', '.popover.in', '.bootbox',
].join(',')

function navigationApi(): EventTarget | null {
  const navigation: unknown = Reflect.get(window, 'navigation')
  return navigation instanceof EventTarget ? navigation : null
}

/** List screen of v7 whose records may open over it. */
export function supportsRecordOverlay(module: string, view: string, modules: readonly string[]): boolean {
  return view === 'List'
    && (modules.length === 0 || modules.includes(module))
    && navigationApi() !== null
    && document.getElementById('overlayPageContent') !== null
    && document.getElementById('listViewContent') !== null
}

interface Restore {
  readonly x: number
  readonly y: number
  readonly table: readonly [number, number] | null
  readonly focus: Element | null
  readonly row: string
}

export function startRecordOverlay(scope: IslandScope, module: string, texts: RecordOverlayTexts): void {
  const navigation = navigationApi()
  const overlay = document.getElementById('overlayPageContent')
  if (navigation === null || overlay === null) {
    return
  }
  const html = document.documentElement
  let state: State = 'closed'
  let target: RecordTarget | null = null
  let detail: unknown = null
  /** Handlers the current record view of v7 added to persistent elements. */
  let added: readonly AddedHandler[] = []
  /** focusin handlers the shows of the page overlay added (released when the overlay closes). */
  let focusHandlers: AddedHandler[] = []
  /** window.onbeforeunload before the edit form set its own. */
  let beforeUnload: typeof window.onbeforeunload | undefined
  /** A record was saved while it was shown: the list reloads its page when the overlay closes. */
  let dirty = false
  /** The full page is opening on purpose (fallback): our own navigation is not intercepted. */
  let leaving = false
  /** The history entry of the record was added by this page (Back returns to the list), not restored after a reload. */
  let ownEntry = false
  /** history.back() issued by the overlay itself: the popstate it causes is not a user action. */
  let ownBack = false
  let restore: Restore | null = null
  let restoreController: (() => void) | null = null
  let restoreMetadata: (() => void) | null = null
  let presentation: ReturnType<typeof createScope> | null = null

  const listRow = (record: string): Element | null => document.querySelector(`#listViewContent tr.listViewEntries[data-id="${record}"]`)
  const table = (): Element | null => document.querySelector('#listViewContent #table-content')
  /** The element of a row that gets the focus back: the visible link to the record (rows also hold hidden action links). */
  const rowFocus = (row: Element | null): HTMLElement | null => {
    if (row === null) {
      return null
    }
    const active = document.activeElement
    if (active instanceof HTMLElement && row.contains(active) && active.getClientRects().length > 0) {
      return active
    }
    const links = Array.from(row.querySelectorAll<HTMLElement>('a[href]')).filter((link) => link.getClientRects().length > 0)
    return links.find((link) => (link.getAttribute('href') ?? '').includes('view=Detail')) ?? links[0] ?? null
  }
  const rowLink = (record: string): Element | null => rowFocus(listRow(record))

  const mark = (on: boolean): void => {
    overlay.classList.toggle(OVERLAY_CLASS, on)
    overlay.setAttribute('aria-hidden', on ? 'false' : 'true')
    if (on) { overlay.setAttribute('aria-modal', 'true') } else { overlay.removeAttribute('aria-modal') }
    if (on && target !== null) {
      html.setAttribute(RECORD_ATTRIBUTE, target.record)
    } else {
      html.removeAttribute(RECORD_ATTRIBUTE)
    }
  }

  /** The record view of v7 goes (another view replaces it or the overlay closed). */
  const leaveView = (): void => {
    presentation?.dispose()
    presentation = null
    release(added)
    added = []
    restoreController?.()
    restoreController = null
    if (beforeUnload !== undefined) {
      window.onbeforeunload = beforeUnload
      beforeUnload = undefined
    }
    html.dataset['muRecordHandlers'] = String(handlerCount())
  }

  const fullPage = (record: RecordTarget, error: unknown): void => {
    console.warn('[ModernUI] the record could not open over the list, opening its page:', error)
    leaving = true
    state = 'closed'
    leaveView()
    restoreMetadata?.(); restoreMetadata = null
    mark(false)
    try {
      notifyError(texts.fallback)
    } catch {
      // the notification is only a courtesy
    }
    window.location.assign(recordUrl(record))
  }

  const focusIn = (): void => {
    const close = overlay.querySelector<HTMLElement>('.mu-record-back, .overlayDetailHeader .close, .overlayHeader .close')
    ;(close ?? overlay).focus({ preventScroll: true })
  }

  const showRecord = async (record: RecordTarget, push: boolean): Promise<void> => {
    state = 'opening'
    target = record
    try {
      await ensureRecordScripts()
      const answer = await request('get', {
        data: { module: 'ModernUI', view: 'Record', sourceModule: record.module, record: record.record },
      })
      if (typeof answer !== 'string' || !answer.includes('overlayDetail')) {
        throw new Error('unexpected answer of the overlay record view')
      }
      if (target !== record) {
        return
      }
      await ensureDetailDependencies(answer)
      if (target !== record) return
      leaveView()
      const shown = await trackedFocus(() => showPageOverlay(answer))
      focusHandlers.push(...shown.added)
      const container = shown.result
      const root = overlay.querySelector<HTMLElement>('.mu-cloud-record')
      if (root === null) { throw new Error('missing record container') }
      restoreMetadata?.()
      restoreMetadata = installRecordMeta(root)
      mark(true)
      const started = tracked(() => {
        const started = startCloudDetail(record.module, container, (error) => { fullPage(record, error) })
        restoreController = started.restore
        // Same event as Detail.js after the overlay of a related record (extensions that decorate record views listen to it).
        trigger('post.overlay.load', null, { module: record.module, record: record.record, displayMode: 'overlay' })
        return started.instance
      })
      detail = started.result
      added = started.added
      presentation = createScope('record-presentation')
      presentRecord(presentation, root, texts, () => { hidePageOverlay() })
      if (push) {
        history.pushState(withRecord(history.state, record), '', window.location.href)
        ownEntry = true
      }
      state = 'detail'
      focusIn()
    } catch (error) {
      fullPage(record, error)
    }
  }

  const open = (record: RecordTarget, row: Element | null, push: boolean): void => {
    const scroller = table()
    restore = {
      x: window.scrollX,
      y: window.scrollY,
      table: scroller === null ? null : [scroller.scrollTop, scroller.scrollLeft],
      focus: rowFocus(row),
      row: record.record,
    }
    void showRecord(record, push)
  }

  const showEdit = async (url: string): Promise<void> => {
    const record = target
    if (record === null || detail === null) {
      return
    }
    state = 'opening'
    try {
      const answer = await request('get', { data: { ...urlParams(url), displayMode: 'overlay' } })
      if (typeof answer !== 'string' || !answer.includes('overlayEdit')) {
        throw new Error('unexpected answer of the overlay edit view')
      }
      if (target !== record) return
      leaveView()
      const shown = await trackedFocus(() => showPageOverlay(answer))
      focusHandlers.push(...shown.added)
      const container = shown.result
      mark(true)
      beforeUnload = window.onbeforeunload
      const instance = detail
      added = tracked(() => {
        startEdit(instance, record.module, container)
      }).added
      state = 'edit'
      overlay.querySelector<HTMLElement>('form#EditView input:not([type=hidden]), form#EditView select, form#EditView textarea')?.focus({ preventScroll: true })
    } catch (error) {
      fullPage(record, error)
    }
  }

  /** After the overlay is hidden (any way: Back, Escape, the buttons of v7, the standard view). */
  const finish = (): void => {
    const was = restore
    const reload = dirty
    leaveView()
    restoreMetadata?.(); restoreMetadata = null
    release(focusHandlers)
    focusHandlers = []
    html.dataset['muRecordHandlers'] = String(handlerCount())
    state = 'closed'
    target = null
    detail = null
    dirty = false
    restore = null
    mark(false)
    if (stateRecord(history.state, module) !== null) {
      if (ownEntry) {
        ownBack = true
        history.back()
      } else {
        history.replaceState(withRecord(history.state, null), '', window.location.href)
      }
    }
    ownEntry = false
    const back = (): void => {
      if (was === null) {
        return
      }
      window.scrollTo(was.x, was.y)
      const scroller = table()
      if (was.table !== null && scroller !== null) {
        scroller.scrollTop = was.table[0]
        scroller.scrollLeft = was.table[1]
      }
      const focus = was.focus?.isConnected === true ? was.focus : rowLink(was.row)
      if (focus instanceof HTMLElement) {
        focus.focus({ preventScroll: true })
      }
    }
    if (reload) {
      reloadList().then(back, back)
    } else {
      back()
    }
  }

  const close = (): void => {
    if (state !== 'closed') {
      state = 'opening'
      hidePageOverlay()
    }
  }

  /**
   * The edit form was submitted (after the validation and the pre-save event of v7 and of extensions — some of them submit
   * with form.submit(), which fires no submit event, so the navigation itself is the reliable point): the same form data go
   * to the same action by app.request instead of a page load.
   */
  const save = (record: RecordTarget, data: FormData): void => {
    state = 'opening'
    const form = overlay.querySelector<HTMLFormElement>('form#EditView')
    request('post', { data: withCsrf(data), contentType: false, processData: false }).then(() => {
      hideProgress()
      dirty = true
      void showRecord(record, false)
    }, (error: unknown) => {
      hideProgress()
      state = 'edit'
      form?.querySelector<HTMLButtonElement>('.saveButton')?.removeAttribute('disabled')
      trigger('post.save.failed', error instanceof Error ? Reflect.get(error, 'detail') : error)
    })
  }

  // 1. The navigation v7 starts for a row of the list becomes the overlay; the submit of the edit form becomes a save.
  scope.listen(navigation, 'navigate', (event: Event) => {
    if (leaving || !event.cancelable) {
      return
    }
    const submitted: unknown = Reflect.get(event, 'formData')
    if (submitted instanceof FormData) {
      if (state === 'edit' && target !== null && submitted.get('module') === target.module && submitted.get('action') === 'Save'
        && submitted.get('record') === target.record) {
        event.preventDefault()
        save(target, submitted)
      }
      return
    }
    if (state !== 'closed' && state !== 'opening') {
      const destination: unknown = Reflect.get(event, 'destination')
      const url: unknown = typeof destination === 'object' && destination !== null ? Reflect.get(destination, 'url') : null
      if (state === 'detail' && target !== null && typeof url === 'string') {
        const next = recordTarget(url, module)
        if (next !== null && listRow(next.record) !== null) {
          event.preventDefault()
          history.replaceState(withRecord(history.state, next), '', location.href)
          void showRecord(next, false)
          return
        }
        const edit = new URL(url, document.baseURI)
        if (edit.origin === location.origin && edit.pathname === new URL('index.php', document.baseURI).pathname
          && edit.searchParams.get('view') === 'Edit' && edit.searchParams.get('module') === target.module
          && edit.searchParams.get('record') === target.record) {
          event.preventDefault()
          void showEdit(url)
        }
      }
      return
    }
    const type: unknown = Reflect.get(event, 'navigationType')
    const destination: unknown = Reflect.get(event, 'destination')
    const url: unknown = typeof destination === 'object' && destination !== null ? Reflect.get(destination, 'url') : null
    if ((type !== 'push' && type !== 'replace') || Reflect.get(event, 'hashChange') === true
      || Reflect.get(event, 'downloadRequest') != null || typeof url !== 'string') {
      return
    }
    const record = recordTarget(url, module)
    const row = record !== null ? listRow(record.record) : null
    if (record === null || row === null) {
      return
    }
    event.preventDefault()
    resetRowTimers(row)
    // A second row clicked while the first record is loading (before the backdrop covers the list): only the first opens.
    if (state === 'closed') {
      open(record, row, true)
    }
  })

  // 2. History: Back closes, Forward opens again.
  scope.listen(window, 'popstate', (event: Event) => {
    if (ownBack) {
      ownBack = false
      return
    }
    const wanted = stateRecord((event as PopStateEvent).state, module)
    if (state !== 'closed' && wanted === null) {
      ownEntry = false
      close()
    } else if (state === 'closed' && wanted !== null && listRow(wanted) !== null) {
      ownEntry = true
      open({ module, record: wanted }, listRow(wanted), false)
    }
  })

  // 3. Handlers on the overlay of v7 (jQuery events: Bootstrap triggers them through jQuery).
  // Only the overlay itself: hidden.bs.modal of a popup opened inside it (reference fields) bubbles up to it too.
  const offHidden = onJQuery(overlay, 'hidden.bs.modal', (event) => {
    if (state !== 'closed' && Reflect.get(event as object, 'target') === overlay) {
      finish()
    }
  })
  const offEdit = onJQuery(overlay, 'click', (event) => {
    const button: unknown = Reflect.get(event as object, 'currentTarget')
    const url = button instanceof HTMLElement ? (button.getAttribute('value') ?? '') : ''
    if (state === 'detail' && url !== '') {
      const prevent: unknown = Reflect.get(event as object, 'preventDefault')
      if (typeof prevent === 'function') {
        Reflect.apply(prevent, event, [])
      }
      void showEdit(url)
    }
  }, '.editRelatedRecord')
  scope.onDispose(() => {
    offHidden()
    offEdit()
    if (state !== 'closed') {
      hidePageOverlay()
    }
    leaveView()
    restoreMetadata?.(); restoreMetadata = null
    release(focusHandlers)
    focusHandlers = []
    mark(false)
  })

  // 5. Escape: the record closes, the form acts as its Cancel; popups of v7 over it keep their own Escape.
  scope.listen(document, 'keydown', (event: Event) => {
    const key = event as KeyboardEvent
    if (key.key !== 'Escape' || key.defaultPrevented || (state !== 'detail' && state !== 'edit')) {
      return
    }
    let nested = true
    try {
      nested = Number(Reflect.get($(NESTED_POPUP) as object, 'length')) > 0
    } catch {
      // without jQuery nothing is decided here
    }
    if (nested) {
      return
    }
    key.preventDefault()
    const cancel = state === 'edit' ? overlay.querySelector<HTMLElement>('form#EditView .cancelLink') : null
    if (cancel !== null) {
      cancel.click()
    } else {
      close()
    }
  })

  // 6. A field saved inline in the record: the list shows the new value after the overlay closes.
  scope.onAppEvent('PostAjaxSaveEvent', () => {
    if (state !== 'closed') {
      dirty = true
    }
  })

  html.dataset['muRecordHandlers'] = String(handlerCount())

  // 7. A reload of the page or a return from another page with the record in the history entry: the record again
  // (only for these two kinds of page load: a new navigation to the list starts without it).
  const entry = performance.getEntriesByType('navigation')[0]
  const kind = entry instanceof PerformanceNavigationTiming ? entry.type : 'navigate'
  const initial = kind === 'reload' || kind === 'back_forward' ? stateRecord(history.state, module) : null
  if (initial !== null && listRow(initial) !== null) {
    ownEntry = false
    open({ module, record: initial }, listRow(initial), false)
  }
}
