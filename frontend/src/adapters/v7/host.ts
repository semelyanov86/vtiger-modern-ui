/**
 * Access to the Vtiger 7 host page (docs/architecture.md §3.9): CSRF token, page readiness, notifications.
 * Only reads globals with checks; never replaces window.$ / jQuery and never publishes a global Vue.
 */
import { isRecord } from '../../api/guards'

/** csrf-magic token and field name of the page, or null when the page has none. */
export function csrfToken(): { name: string; value: string } | null {
  const value = window.csrfMagicToken
  const name = window.csrfMagicName
  if (typeof value !== 'string' || value === '') {
    return null
  }
  return { name: typeof name === 'string' && name !== '' ? name : '__vtrftk', value }
}

type ReadyFunction = (callback: () => void) => unknown

function jqueryReady(): ReadyFunction | null {
  const jq = window.jQuery
  if (typeof jq !== 'function') {
    return null
  }
  return (callback) => {
    // jQuery(fn) runs fn after the handlers registered earlier, i.e. after app.controller() of v7.
    Reflect.apply(jq, window, [callback])
  }
}

/** Resolves after the host page is ready (after the v7 controller has registered its events). */
export function hostReady(): Promise<void> {
  return new Promise((resolve) => {
    const ready = jqueryReady()
    if (ready !== null) {
      ready(() => {
        resolve()
      })
      return
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        resolve()
      }, { once: true })
    } else {
      resolve()
    }
  })
}

/** Shows a message through the notifications of v7 (app.helper), falls back to the console. */
export function notify(kind: 'success' | 'error', message: string): void {
  const app = window.app
  const helper = isRecord(app) ? app['helper'] : undefined
  const method = isRecord(helper) ? helper[kind === 'success' ? 'showSuccessNotification' : 'showErrorNotification'] : undefined
  if (typeof method === 'function') {
    Reflect.apply(method, helper, [{ message }])
    return
  }
  if (kind === 'error') {
    console.warn(`[ModernUI] ${message}`)
  } else {
    console.info(`[ModernUI] ${message}`)
  }
}
