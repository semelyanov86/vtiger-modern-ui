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

/**
 * Subscribes to app.event of v7 (a jQuery event bus, layouts/v7/resources/application.js) with this handler only;
 * returns the function that removes exactly this handler. Without the bus (unknown page) nothing happens.
 */
export function subscribeAppEvent(name: string, handler: (...args: unknown[]) => void): () => void {
  const app = window.app
  const bus = isRecord(app) ? app['event'] : undefined
  const on = isRecord(bus) ? bus['on'] : undefined
  const off = isRecord(bus) ? bus['off'] : undefined
  if (typeof on !== 'function' || typeof off !== 'function') {
    return () => undefined
  }
  // jQuery passes the event object first, then the arguments of trigger().
  const listener = (_event: unknown, ...args: unknown[]): void => {
    handler(...args)
  }
  Reflect.apply(on, bus, [name, listener])
  return () => {
    Reflect.apply(off, bus, [name, listener])
  }
}

/** Kind of page the shell runs on (docs/architecture.md §7.3, levels of stage 04). */
export type PageLevel = 'islands' | 'skin'

/**
 * Capability check of the page: the islands need the v7 layout (page container, fixed header with #navbar, the
 * page metadata and the v7 application object). Anything else — an extension with its own page shell, an
 * unknown layout — gets the skin only: the theme never breaks a screen it does not know.
 */
export function detectPageLevel(): PageLevel {
  const navbar = document.getElementById('navbar')
  const known = document.getElementById('page') !== null
    && navbar !== null
    && navbar.closest('nav.app-fixed-navbar') !== null
    && isRecord(window._META)
    && isRecord(window.app)
  return known ? 'islands' : 'skin'
}
