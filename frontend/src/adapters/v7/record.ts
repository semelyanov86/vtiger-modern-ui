/**
 * The overlay record views of Vtiger 8.4 (docs/architecture.md A15): the core loads a record "over" a page with
 * view=Detail&mode=showDetailViewByMode&displayMode=overlay (OverlayDetailView.tpl) and view=Edit&displayMode=overlay
 * (OverlayEditView.tpl) into the page overlay #overlayPageContent (app.helper.loadPageContentOverlay) and runs the
 * handlers of Vtiger_Detail_Js / Vtiger_Edit_Js on them — the same steps Detail.js makes for a row of a related list
 * (registerRelatedRowClickEvent, showOverlayEditView). This file is the only place that touches these globals; every access
 * is checked and a missing piece throws, so the caller can fall back to the full page of the record.
 *
 * Requests of v7 content go through app.request (jQuery.ajax) on purpose: csrf-magic adds its token there and extensions
 * that re-scan the page on ajaxComplete see the record exactly as after a request of v7 itself.
 */
import { isRecord } from '../../api/guards'

type Callable = (...args: unknown[]) => unknown

/** A function of a host object, bound to it; throws when the host does not have it. */
function method(owner: unknown, name: string): Callable {
  const value: unknown = isRecord(owner) || typeof owner === 'function' ? Reflect.get(owner, name) : undefined
  if (typeof value !== 'function') {
    throw new Error(`v7: ${name} is not available`)
  }
  return (...args: unknown[]): unknown => Reflect.apply(value, owner, args)
}

function global(name: string): unknown {
  return Reflect.get(window, name)
}

/** jQuery of the host page (never replaced, never used for requests of ModernUI itself). */
export function $(target: unknown): unknown {
  const jq = window.jQuery
  if (typeof jq !== 'function') {
    throw new Error('v7: jQuery is not available')
  }
  return Reflect.apply(jq, window, [target])
}

function app(): unknown {
  const value = window.app
  if (!isRecord(value)) {
    throw new Error('v7: app is not available')
  }
  return value
}

/** Error of app.request (VtError) or of the transport, as a message for the log. */
export class V7RequestError extends Error {
  readonly detail: unknown

  constructor(detail: unknown) {
    super(isRecord(detail) && typeof detail['message'] === 'string' ? detail['message'] : 'v7 request failed')
    this.name = 'V7RequestError'
    this.detail = detail
  }
}

/** app.request.get/post of v7 ({data, …} as v7 takes them): resolves with the answer, rejects with the VtError v7 reports. */
export function request(kind: 'get' | 'post', params: Record<string, unknown>): Promise<unknown> {
  const requests = Reflect.get(app() as object, 'request')
  const deferred = method(requests, kind)(params)
  return new Promise((resolve, reject) => {
    method(deferred, 'then')((error: unknown, data: unknown) => {
      if (error !== null && error !== undefined) {
        reject(new V7RequestError(error))
      } else {
        resolve(data)
      }
    })
  })
}

/** app.convertUrlToDataParams() of v7 for a link of the record (Edit button of the overlay). */
export function urlParams(url: string): Record<string, unknown> {
  const params = method(app(), 'convertUrlToDataParams')(url)
  return isRecord(params) ? { ...params } : {}
}

function helper(): unknown {
  return Reflect.get(app() as object, 'helper')
}

/** Puts the HTML into the page overlay of v7 (shown or already shown); resolves with its jQuery object. */
export function showPageOverlay(html: string): Promise<unknown> {
  const deferred = method(helper(), 'loadPageContentOverlay')(html, { backdrop: 'static', keyboard: false })
  return new Promise((resolve) => {
    method(deferred, 'then')((container: unknown) => {
      resolve(container)
    })
  })
}

/** Hides the progress indicator of v7 (some builds show one on submit and expect the page to unload). */
export function hideProgress(): void {
  try {
    method(helper(), 'hideProgress')()
  } catch {
    // nothing shown, nothing to hide
  }
}

export function hidePageOverlay(): void {
  method(helper(), 'hidePageContentOverlay')()
}

export function notifyError(message: string): void {
  method(helper(), 'showErrorNotification')({ message })
}

/** app.event.trigger() of v7 (the bus extensions listen to). */
export function trigger(name: string, ...args: unknown[]): void {
  method(Reflect.get(app() as object, 'event'), 'trigger')(name, ...args)
}

/** The controller of the page (the list of v7): reloads the current page of the list with its filter, search and sort. */
export function reloadList(): Promise<void> {
  const controller = method(app(), 'controller')()
  const deferred = method(controller, 'loadListViewRecords')()
  return new Promise((resolve) => {
    method(deferred, 'then')(() => {
      resolve()
    })
  })
}

/** The jQuery Deferred-free form of $.find(): first match inside a jQuery object. */
function find(container: unknown, selector: string): unknown {
  return method(container, 'find')(selector)
}

/**
 * Scripts of the record view of v7 that a list page does not load (Vtiger_Detail_Js, Vtiger_RelatedList_Js): the core
 * files themselves, by their path in the layout, with the version suffix the page uses for its own scripts.
 */
export async function ensureRecordScripts(): Promise<void> {
  const own = document.querySelector<HTMLScriptElement>('script[src*="modules/Vtiger/resources/List.js"], script[src*="modules/Vtiger/resources/Vtiger.js"]')
  const suffix = own !== null ? (/\?[^#]*$/.exec(own.getAttribute('src') ?? '')?.[0] ?? '') : ''
  for (const [name, file] of [['Vtiger_Detail_Js', 'Detail.js'], ['Vtiger_RelatedList_Js', 'RelatedList.js']] as const) {
    if (global(name) !== undefined) {
      continue
    }
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = `layouts/v7/modules/Vtiger/resources/${file}${suffix}`
      script.dataset['muCore'] = file
      script.onload = () => {
        resolve()
      }
      script.onerror = () => {
        script.remove()
        reject(new Error(`v7: ${file} did not load`))
      }
      document.body.appendChild(script)
    })
    if (global(name) === undefined) {
      throw new Error(`v7: ${name} is not defined by ${file}`)
    }
  }
}

/**
 * Handlers of the overlay record view, as Detail.js (registerRelatedRowClickEvent) registers them for a related record:
 * inline edit with its validation and save, blocks, references, picklist dependencies. The Edit button and the save of the
 * edit form are handled by the caller (see overlay.ts): the core versions reload a related list of a parent record.
 * @returns the Vtiger_Detail_Js instance of the module
 */
export function startDetail(module: string, container: unknown): unknown {
  const factory = method(global('Vtiger_Detail_Js'), 'getInstanceByModuleName')
  const detail = factory(module)
  const holder = find(container, '.overlayDetail')
  method(detail, 'showScroll')($('.overlayDetail .modal-body'))
  method(detail, 'setModuleName')(module)
  method(detail, 'setOverlayDetailMode')(true)
  method(detail, 'setContentHolder')(holder)
  method(detail, 'setDetailViewContainer')(holder)
  method(detail, 'registerBasicEvents')()
  method(detail, 'registerClickEvent')()
  method(detail, 'registerHeaderAjaxEditEvents')(find(container, '.overlayDetailHeader'))
  return detail
}

/**
 * Handlers of the overlay edit form, as Detail.js (showOverlayEditView) registers them: Vtiger_Edit_Js of the module in
 * overlay mode (validation, references, picklist dependencies, leaving without saving), then post.overLayEditView.loaded
 * for the extensions that change overlay forms.
 */
export function startEdit(detail: unknown, module: string, container: unknown): void {
  method(detail, 'registerOverlayEditEvents')(module, container)
  trigger('post.overLayEditView.loaded', $('.overlayEdit'))
}

/** csrf-magic token of the page: a form loaded by AJAX has no hidden field of it (output rewriting is off for AJAX). */
export function withCsrf(data: FormData): FormData {
  const value = window.csrfMagicToken
  const name = typeof window.csrfMagicName === 'string' && window.csrfMagicName !== '' ? window.csrfMagicName : '__vtrftk'
  if (typeof value === 'string' && value !== '' && !data.has(name)) {
    data.append(name, value)
  }
  return data
}

/**
 * Resets the delayed navigation of the links of a list row the way v7 itself does on a double click (List.js,
 * registerRowDoubleClickEvent): the navigation they started was replaced by the overlay.
 */
export function resetRowTimers(row: Element): void {
  for (const link of row.querySelectorAll('a')) {
    const element = $(link)
    const timer = method(element, 'data')('timer')
    if (typeof timer === 'number') {
      window.clearTimeout(timer)
      method(element, 'data')('timer', null)
    }
  }
}

/** A jQuery handler some code added (element, "type.namespace", delegate selector, function). */
export interface AddedHandler {
  readonly target: object
  readonly type: string
  readonly selector: string | undefined
  readonly handler: unknown
}

function jqueryData(target: object): Map<string, unknown[]> {
  const result = new Map<string, unknown[]>()
  const jq = window.jQuery
  const internal: unknown = typeof jq === 'function' ? Reflect.get(jq, '_data') : undefined
  if (typeof internal !== 'function') {
    return result
  }
  const events: unknown = Reflect.apply(internal, jq, [target, 'events'])
  if (!isRecord(events)) {
    return result
  }
  for (const [type, list] of Object.entries(events)) {
    if (Array.isArray(list)) {
      result.set(type, [...(list as unknown[])])
    }
  }
  return result
}

/**
 * Elements whose jQuery handlers outlive one overlay record view: the event bus of v7 (app.event), the page overlay, the
 * document, the window, and the close/cancel buttons of the other modals of the page (helper.registerModalDismissWithoutSubmit
 * binds to every ".modal .close, .modal .cancelLink" each time an edit form starts).
 */
function persistentTargets(): object[] {
  const targets: object[] = [document, window, document.body]
  const bus = Reflect.get(Reflect.get(app() as object, 'event') as object, 'el')
  const busElement: unknown = isRecord(bus) || Array.isArray(bus) ? Reflect.get(bus as object, 0) : undefined
  if (typeof busElement === 'object' && busElement !== null) {
    targets.push(busElement)
  }
  const overlay = document.getElementById('overlayPageContent')
  if (overlay !== null) {
    targets.push(overlay)
  }
  for (const element of document.querySelectorAll('.modal .close, .modal .cancelLink')) {
    if (!(overlay?.contains(element) ?? false)) {
      targets.push(element)
    }
  }
  return targets
}

/**
 * Runs a start function of v7 and returns, with its result, the jQuery handlers it added to the persistent elements — so
 * they are removed when this record view goes, and opening records again does not pile up handlers.
 */
export function tracked<T>(start: () => T): { readonly result: T; readonly added: readonly AddedHandler[] } {
  const targets = persistentTargets()
  const before = new Map<object, Set<unknown>>()
  for (const target of targets) {
    before.set(target, new Set([...jqueryData(target).values()].flat()))
  }
  const result = start()
  const added: AddedHandler[] = []
  for (const target of persistentTargets()) {
    const known = before.get(target) ?? new Set<unknown>()
    for (const [, list] of jqueryData(target)) {
      for (const handleObj of list) {
        if (known.has(handleObj) || !isRecord(handleObj)) {
          continue
        }
        const origType = handleObj['origType']
        const namespace = handleObj['namespace']
        const selector = handleObj['selector']
        if (typeof origType !== 'string') {
          continue
        }
        added.push({
          target,
          type: typeof namespace === 'string' && namespace !== '' ? `${origType}.${namespace}` : origType,
          selector: typeof selector === 'string' && selector !== '' ? selector : undefined,
          handler: handleObj['handler'],
        })
      }
    }
  }
  return { result, added }
}

/**
 * focusin handlers of the document added while the page overlay was shown: v7 replaces enforceFocus of the Bootstrap modal
 * (application.js) with a version that binds focusin.modal on every show and never unbinds it. They are removed when the
 * record closes (only focusin of the document, the one thing that show adds there).
 */
export async function trackedFocus<T>(show: () => Promise<T>): Promise<{ readonly result: T; readonly added: readonly AddedHandler[] }> {
  const known = new Set(jqueryData(document).get('focusin') ?? [])
  const result = await show()
  const added: AddedHandler[] = []
  for (const handleObj of jqueryData(document).get('focusin') ?? []) {
    if (!known.has(handleObj) && isRecord(handleObj) && typeof handleObj['origType'] === 'string') {
      const namespace = handleObj['namespace']
      const selector = handleObj['selector']
      added.push({
        target: document,
        type: typeof namespace === 'string' && namespace !== '' ? `${handleObj['origType']}.${namespace}` : handleObj['origType'],
        selector: typeof selector === 'string' && selector !== '' ? selector : undefined,
        handler: handleObj['handler'],
      })
    }
  }
  return { result, added }
}

export function release(handlers: readonly AddedHandler[]): void {
  for (const added of handlers) {
    try {
      const element = $(added.target)
      if (added.selector === undefined) {
        method(element, 'off')(added.type, added.handler)
      } else {
        method(element, 'off')(added.type, added.selector, added.handler)
      }
    } catch {
      // an element of v7 that is gone has no handlers left
    }
  }
}

/** Number of jQuery handlers on the persistent elements (diagnostics: html[data-mu-record-handlers], e2e). */
export function handlerCount(): number {
  return persistentTargets().reduce((sum, target) => sum + [...jqueryData(target).values()].reduce((count, list) => count + list.length, 0), 0)
}

/**
 * jQuery event handler of an element managed by v7 (Bootstrap events are jQuery events, not DOM events); returns the
 * function that removes exactly this handler (own namespace).
 */
export function onJQuery(target: unknown, events: string, handler: (event: unknown) => void, selector?: string): () => void {
  const element = $(target)
  const namespaced = events.split(' ').map((name) => `${name}.modernuiRecord`).join(' ')
  if (selector === undefined) {
    method(element, 'on')(namespaced, handler)
  } else {
    method(element, 'on')(namespaced, selector, handler)
  }
  return () => {
    method(element, 'off')(namespaced, handler)
  }
}
