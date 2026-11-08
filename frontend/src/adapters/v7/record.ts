/**
 * Bridge to the native Vtiger 8.4 Detail controller (docs/architecture.md A15). ModernUI composes the native view in
 * the existing page overlay; subsequent tabs, inline saves and forms use the CRM routes, metadata and handlers.
 * Native dependencies load once, and controller/metadata/handlers are scoped to the lifetime of the open record.
 * Requests use the native app.request/jQuery transport so csrf-magic and extension ajaxComplete hooks behave as in v7.
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

/** Load native header and field-template dependencies once, before their inline initialization runs. */
export async function ensureDetailDependencies(html: string): Promise<void> {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const styles: unknown = JSON.parse(parsed.querySelector('[data-mu-record-styles]')?.getAttribute('data-mu-record-styles') ?? '[]')
  if (!Array.isArray(styles) || !styles.every((href: unknown) => typeof href === 'string')) {
    throw new Error('v7: invalid record styles')
  }
  const loadedStyles = new Set(Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map((link) => new URL(link.href).pathname))
  for (const href of styles) {
    const url = new URL(href, document.baseURI)
    if (loadedStyles.has(url.pathname)) continue
    if (url.origin !== location.origin || !url.pathname.endsWith('.css')) throw new Error('v7: unsupported record style')
    await new Promise<void>((resolve, reject) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'; link.href = url.href
      link.onload = () => { resolve() }
      link.onerror = () => { link.remove(); reject(new Error(`v7: ${url.pathname} did not load`)) }
      // Native dependencies precede the theme, just as on the full Detail page.
      document.head.insertBefore(link, document.querySelector('link[href*="ModernUI/resources/dist/"]'))
    })
    loadedStyles.add(url.pathname)
  }
  const descriptor = parsed.querySelector('[data-mu-record-scripts]')?.getAttribute('data-mu-record-scripts')
  if (descriptor === null || descriptor === undefined) {
    throw new Error('v7: missing record dependencies')
  }
  const scripts: unknown = JSON.parse(descriptor)
  if (!Array.isArray(scripts) || !scripts.every((src: unknown) => typeof src === 'string')) {
    throw new Error('v7: invalid record dependencies')
  }
  const loaded = new Set(Array.from(document.scripts).filter((script) => script.src !== '').map((script) => new URL(script.src).pathname))
  // Some native uitypes declare their libraries in the field template, outside getHeaderScripts().
  // Preload those too before inserting the form; its inline handlers must see the original plugins.
  const embedded = Array.from(parsed.querySelectorAll<HTMLScriptElement>('script[src]')).map((script) => script.getAttribute('src') ?? '')
  for (const src of [...scripts, ...embedded]) {
    const url = new URL(src, document.baseURI)
    if (url.origin !== location.origin || !url.pathname.endsWith('.js')) {
      throw new Error('v7: unsupported record dependency')
    }
    if (loaded.has(url.pathname)) {
      continue
    }
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = url.href
      script.onload = () => { resolve() }
      script.onerror = () => { script.remove(); reject(new Error(`v7: ${url.pathname} did not load`)) }
      document.body.appendChild(script)
    })
    loaded.add(url.pathname)
  }
}

/** Metadata generated by the native view, with the interface its validators use in Detail and OverlayEdit. */
export function installRecordMeta(root: HTMLElement): () => void {
  const fields: unknown = JSON.parse(root.dataset['muRecordFields'] ?? '{}')
  if (!isRecord(fields)) throw new Error('missing native field metadata')
  const original = global('uimeta')
  const related = global('related_uimeta')
  const field = (name: string): unknown => fields[name]
  const property = (name: string, key: string): unknown => {
    const value = field(name)
    return isRecord(value) ? value[key] : undefined
  }
  const meta = { field: {
    get: (name: string, key?: string): unknown => key === undefined ? field(name) : property(name, key),
    isMandatory: (name: string): unknown => property(name, 'mandatory') ?? false,
    getType: (name: string): unknown => property(name, 'type') ?? false,
  } }
  Reflect.set(window, 'uimeta', meta)
  Reflect.set(window, 'related_uimeta', meta)
  return () => { Reflect.set(window, 'uimeta', original); Reflect.set(window, 'related_uimeta', related) }
}

/** Native full-detail handlers against their native selectors, inside the page overlay. */
export function startCloudDetail(module: string, container: unknown, failed: (error: unknown) => void): { instance: unknown; restore: () => void } {
  const detailClass = global('Vtiger_Detail_Js') as object
  const detail = method(detailClass, 'getInstanceByModuleName')(module)
  const originalDetail = Reflect.get(detailClass, 'detailInstance') as unknown
  const holder = find(container, '.mu-cloud-record')
  // Legacy related-list helpers look up these hidden controls by a document-wide ID. A full Detail has only one
  // set; the overlay also has the background list's set. Keep its values intact, but give the open record the IDs.
  const backgroundIds = Array.from(document.querySelectorAll<HTMLElement>('#listViewContent input[id]'))
    .filter((input) => ['currentSearchParams', 'orderBy', 'sortOrder', 'pageNumber', 'pageLimit', 'noFilterCache', 'noOfEntries', 'nextPageExist'].includes(input.id))
    .map((input) => ({ input, id: input.id }))
  backgroundIds.forEach(({ input }) => { input.removeAttribute('id') })
  method(detail, 'setModuleName')(module)
  method(detail, 'setContentHolder')(find(holder, '.details'))
  method(detail, 'setDetailViewContainer')(holder)
  // The core has one page-overlay container. Its related-row preview/edit would replace the parent card and its
  // controller in place. Open these native URLs separately, keeping the parent, its tab and the underlying list alive.
  // Business row actions (unlink, check boxes, reference popups) still go to their original handlers.
  const separate = (url: string): void => {
    const destination = new URL(url, document.baseURI)
    if (destination.origin !== location.origin || destination.pathname !== new URL('index.php', document.baseURI).pathname) {
      throw new Error('v7: unsupported related record URL')
    }
    window.open(destination.href, '_blank', 'noopener')
  }
  Reflect.set(detail as object, 'showOverlayEditView', (url: string) => { separate(url) })
  Reflect.set(detail as object, 'registerRelatedRowClickEvent', () => {
    method(find(holder, '.details'), 'on')('click', '.listViewEntries', (event: unknown) => {
      if (!isRecord(event) || !(event['target'] instanceof Element) || !(event['currentTarget'] instanceof HTMLElement)) return
      const target = event['target']
      if (window.getSelection()?.toString() || target.closest('a, button, input, select, textarea, .js-reference-display-value') !== null) return
      if (target.matches('td:first-child') && target.querySelector('input[type="checkbox"]') !== null) return
      const url = event['currentTarget'].dataset['recordurl']
      if (url !== undefined) separate(url)
    })
  })
  const host = app() as Record<string, unknown>
  const original = host['controller']
  const originalView = host['view']
  const indexClass = global('Vtiger_Index_Js') as object
  const indexFactory = Reflect.get(indexClass, 'getInstance') as unknown
  const newIndex = method(indexClass, 'getInstance')
  const delayed = new Set<number>()
  const asynchronousHandlers: AddedHandler[] = []
  let active = true
  let attachmentHover = false
  // The native upload initializer polls forever while no upload field is visible. A page unload normally stops it;
  // closing an overlay does not. Bound its retries to this record and keep the native uploader itself unchanged.
  Reflect.set(indexClass, 'getInstance', () => {
    const instance = newIndex() as object
    const upload = method(instance, 'registerMultiUpload')
    const hover = method(instance, 'registerHoverEventOnAttachment')
    Reflect.set(instance, 'registerHoverEventOnAttachment', () => {
      if (!active || attachmentHover) return
      attachmentHover = true
      asynchronousHandlers.push(...tracked(() => hover()).added)
    })
    const retry = (): void => {
      if (!active) return
      if (method($('input[type="file"].multi'), 'is')(':visible') === true) {
        asynchronousHandlers.push(...tracked(() => upload()).added)
      } else {
        const timer = window.setTimeout(() => { delayed.delete(timer); retry() }, 50)
        delayed.add(timer)
      }
    }
    Reflect.set(instance, 'registerMultiUpload', retry)
    return instance
  })
  const loadContents = method(detail, 'loadContents')
  const requests = Reflect.get(host, 'request') as Record<string, unknown>
  // Native tabs use PJAX for a full-page Detail. In an overlay that would replace the list URL/history and bind global
  // pjax handlers on each click. Only during this synchronous native call, use its ordinary AJAX transport instead.
  Reflect.set(detail as object, 'loadContents', (...args: unknown[]) => {
    const pjax = requests['pjax']
    requests['pjax'] = (params: unknown): unknown => {
      const pending = method(requests, 'get')(params)
      method(pending, 'then')((error: unknown) => { if (error != null) { failed(error) } })
      return pending
    }
    try { return loadContents(...args) } finally { requests['pjax'] = pjax }
  })
  // Native links (delete, PDF, related lists) ask app.controller() for the current record. The list controller remains
  // alive underneath and is restored before a list refresh. Global libraries and the underlying list instance remain unchanged.
  host['controller'] = () => detail
  host['view'] = () => 'Detail'
  Reflect.set(detailClass, 'detailInstance', detail)
  const restore = (): void => {
    active = false
    delayed.forEach((timer) => { window.clearTimeout(timer) })
    release(asynchronousHandlers)
    Reflect.set(indexClass, 'getInstance', indexFactory)
    Reflect.set(detailClass, 'detailInstance', originalDetail)
    host['controller'] = original; host['view'] = originalView
    backgroundIds.forEach(({ input, id }) => { input.id = id })
  }
  try {
    method(detail, 'registerEvents')()
    method(detail, 'registerClickEvent')()
  } catch (error) {
    restore()
    throw error
  }
  return { instance: detail, restore }
}

/**
 * Handlers of the overlay edit form, as Detail.js (showOverlayEditView) registers them: Vtiger_Edit_Js of the module in
 * overlay mode (validation, references, picklist dependencies, leaving without saving), then post.overLayEditView.loaded
 * for the extensions that change overlay forms.
 */
export function startEdit(detail: unknown, module: string, container: unknown): void {
  const instance = detail ?? method(global('Vtiger_Detail_Js'), 'getInstanceByModuleName')(module)
  method(instance, 'registerOverlayEditEvents')(module, container)
  trigger('post.overLayEditView.loaded', $('.overlayEdit'))
}

/** Read the existing validator; never initialise another one or replace the module's rules/submit callback. */
export function nativeFormErrors(form: HTMLFormElement): { element: HTMLElement; message: string }[] {
  const validator: unknown = method($(form), 'data')('validator')
  const list: unknown = isRecord(validator) ? validator['errorList'] : null
  if (!Array.isArray(list)) { return [] }
  return (list as unknown[]).flatMap((error) => isRecord(error) && error['element'] instanceof HTMLElement && typeof error['message'] === 'string'
    ? [{ element: error['element'], message: error['message'] }] : [])
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

/** Same native Save body and jQuery transport/prefilters. app.request drops the xhr option, losing responseURL. */
export function submitNativeForm(form: HTMLFormElement, data: FormData): Promise<string> {
  const xhr = new XMLHttpRequest()
  const action = form.getAttribute('action') ?? ''
  return new Promise((resolve, reject) => {
    method(window.jQuery, 'ajax')({
      // The native hidden input name="action" shadows HTMLFormElement.action.
      url: action === '' ? 'index.php' : action, method: 'POST', data: withCsrf(data), contentType: false, processData: false,
      xhr: () => xhr,
      success: (answer: unknown) => {
        if (isRecord(answer) && answer['success'] === false) reject(new V7RequestError(answer['error']))
        else resolve(xhr.responseURL)
      },
      error: () => { reject(new V7RequestError({ message: xhr.statusText || 'Save request failed' })) },
    })
  })
}

/** Re-enable the native retry path after a refused request, without changing its validator or pre-save handlers. */
export function resetFormSubmit(form: HTMLFormElement): void {
  method($(form), 'removeData')('submit')
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
