/** Conditional Layouts 1.0.0: its full-page listener tests location.view, which stays List in an overlay. */
import type { ExtensionAdapter } from '../types'
import { isRecord } from '../../../api/guards'
import { $ } from '../../v7/record'

function call(owner: unknown, name: string, ...args: unknown[]): unknown {
  const fn: unknown = isRecord(owner) || typeof owner === 'function' ? Reflect.get(owner, name) : undefined
  if (typeof fn !== 'function') throw new Error(`Conditional Layouts: missing ${name}`)
  return Reflect.apply(fn, owner, args)
}

/** Guard the native asynchronous callback: a response for a closed/replaced card must not change the next card. */
export function withLiveResponse(requests: Record<string, unknown>, live: () => boolean, run: () => void): void {
  const post = requests['post']
  if (typeof post !== 'function') throw new Error('Conditional Layouts: missing transport')
  requests['post'] = (...args: unknown[]) => {
    const pending: unknown = Reflect.apply(post, requests, args)
    return { then: (callback: (...values: unknown[]) => unknown): unknown => call(pending, 'then', (...values: unknown[]) => {
      if (live()) return callback(...values)
      return undefined
    }) }
  }
  try { run() } finally { requests['post'] = post }
}

export const controllayoutfields: ExtensionAdapter = {
  id: 'controllayoutfields',
  supports: ({ page }) => {
    const factory: unknown = Reflect.get(window, 'Control_Layout_Fields_Js')
    const enabled: unknown = Reflect.get(window, 'VTECheckLoadHeaderScript')
    return page.view === 'List' && typeof factory === 'function'
      && (typeof enabled !== 'function' || Reflect.apply(enabled, window, ['ControlLayoutFields']) === true)
  },
  start: (scope, { page }) => {
    let active = true
    let generation = 0
    let bound: Element | null = null
    const root = (): HTMLElement | null => document.documentElement.hasAttribute('data-mu-record')
      ? document.querySelector('#overlayPageContent .mu-cloud-record') : null
    const apply = (): void => {
      const card = root()
      const fields = card?.querySelector('#detailView')
      const record = card?.querySelector<HTMLInputElement>('#recordId')?.value
      if (card === null || fields == null || record === undefined) return
      const current = ++generation
      try {
        const factory: unknown = Reflect.get(window, 'Control_Layout_Fields_Js')
        if (typeof factory !== 'function') throw new Error('Conditional Layouts: missing controller')
        const instance: unknown = Reflect.construct(factory, [])
        const requests: unknown = isRecord(window.app) ? window.app['request'] : undefined
        if (!isRecord(requests)) throw new Error('Conditional Layouts: missing requests')
        withLiveResponse(requests, () => active && current === generation && root() === card && fields.isConnected, () => {
          call(instance, 'displayByClfOnDetail', page.module, fields.querySelector('.detailview-table') === null ? undefined : 'full', record)
        })
        if (bound !== fields) {
          call(instance, 'registerInlineAjaxSaveClickEvent')
          bound = fields
        }
      } catch (error) {
        window.dispatchEvent(new CustomEvent('mu:record-extension-error', { detail: error }))
      }
    }
    scope.onAppEvent('post.overlay.load', apply)
    const onComplete = (_event: unknown, xhr: unknown, settings: unknown): void => {
      if (root() === null || !isRecord(settings) || !isRecord(xhr) || Number(xhr['status']) >= 400) return
      const data: unknown = settings['data'] ?? settings['url']
      const params = typeof data === 'string' ? new URLSearchParams(data.includes('?') ? data.slice(data.indexOf('?') + 1) : data) : null
      if (params?.get('module') !== page.module) return
      if (params.get('mode') === 'showDetailViewByMode' || params.get('mode') === 'showCustomDetailViewTab') apply()
      if (params.get('action') === 'SaveAjax' && params.get('record') === document.documentElement.dataset['muRecord']) {
        // The native tab reload restores fields hidden by the previous condition before evaluating the new values.
        call($(root()?.querySelector('.related-tabs .tab-item.active')), 'trigger', 'click')
      }
    }
    const target = $(document)
    call(target, 'on', 'ajaxComplete.modernuiConditionalLayouts', onComplete)
    scope.onDispose(() => {
      active = false
      call(target, 'off', 'ajaxComplete.modernuiConditionalLayouts', onComplete)
    })
    apply() // History restoration may have opened the card before this chunk finished loading.
  },
}
