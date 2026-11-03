/**
 * Runtime of the Vue islands on a v7 page (docs/architecture.md §6, §7.3).
 *
 * An island is a Vue app in a container that belongs to ModernUI ([data-mu-root]); it is never mounted on body,
 * #page or DOM that jQuery manages. The runtime
 *
 * - mounts each registered island once (idempotent start, a second start or a second registration is ignored);
 * - checks the capabilities of the screen first: an island whose insertion point is missing or unexpected is
 *   skipped and the screen stays as v7 renders it;
 * - gives every island a scope for event listeners, app.event subscriptions, timers and observers, all released
 *   on unmount, so repeated mounts never pile up handlers;
 * - notices when v7 re-renders a part of the page (AJAX/PJAX) and the container of an island is gone: the app is
 *   unmounted and mounted again once the insertion point is back. One MutationObserver, its callback only marks
 *   the state dirty; the check runs at most once per animation frame and looks at the registered islands only,
 *   it never scans the document. A container that keeps disappearing stops being mounted after MOUNT_LIMIT mounts;
 * - marks replaced v7 elements on <html> (data-mu-replaced) only after the replacing island has mounted, so the
 *   original is never hidden before the new element exists, and unmarks them on unmount.
 *
 * An exception inside one island unmounts that island only; the others and v7 are not affected.
 */
import type { App } from 'vue'
import { subscribeAppEvent } from '../adapters/v7/host'

export type IslandPlace =
  /** A new container of ModernUI inserted into the page (removed again on unmount). */
  | { readonly kind: 'insert'; readonly parent: Element; readonly before: Node | null; readonly className: string }
  /** A container printed by the server for this island (own pages of the module). */
  | { readonly kind: 'existing'; readonly container: HTMLElement }

export interface IslandScope {
  readonly id: string
  /** addEventListener that is removed on unmount. */
  listen(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): void
  /** app.event of v7 (jQuery event bus); unsubscribed on unmount, never with app.event.off(name) alone. */
  onAppEvent(name: string, handler: (...args: unknown[]) => void): void
  timeout(callback: () => void, ms: number): void
  interval(callback: () => void, ms: number): void
  observe(target: Node, options: MutationObserverInit, callback: MutationCallback): void
  onDispose(callback: () => void): void
}

export interface IslandDefinition {
  readonly id: string
  /** Capability check and insertion point; null: this screen does not offer it, the island is skipped. */
  readonly place: () => IslandPlace | null
  readonly create: (scope: IslandScope) => App
  /** Token added to html[data-mu-replaced] while the island is mounted (CSS hides the v7 original under it). */
  readonly replaces?: string
}

interface Mounted {
  readonly definition: IslandDefinition
  readonly app: App
  readonly container: HTMLElement
  readonly owns: boolean
  readonly scope: Scope
}

/** How many times an island may be mounted on one page (the first mount and remounts after v7 removed it). */
export const MOUNT_LIMIT = 5

class Scope implements IslandScope {
  readonly id: string
  private disposers: (() => void)[] = []

  constructor(id: string) {
    this.id = id
  }

  listen(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, listener, options)
    this.disposers.push(() => {
      target.removeEventListener(type, listener, options)
    })
  }

  onAppEvent(name: string, handler: (...args: unknown[]) => void): void {
    this.disposers.push(subscribeAppEvent(name, handler))
  }

  timeout(callback: () => void, ms: number): void {
    const handle = window.setTimeout(callback, ms)
    this.disposers.push(() => {
      window.clearTimeout(handle)
    })
  }

  interval(callback: () => void, ms: number): void {
    const handle = window.setInterval(callback, ms)
    this.disposers.push(() => {
      window.clearInterval(handle)
    })
  }

  observe(target: Node, options: MutationObserverInit, callback: MutationCallback): void {
    const observer = new MutationObserver(callback)
    observer.observe(target, options)
    this.disposers.push(() => {
      observer.disconnect()
    })
  }

  onDispose(callback: () => void): void {
    this.disposers.push(callback)
  }

  dispose(): void {
    const disposers = this.disposers.reverse()
    this.disposers = []
    for (const dispose of disposers) {
      try {
        dispose()
      } catch (error) {
        console.warn(`[ModernUI] island ${this.id}: cleanup failed`, error)
      }
    }
  }
}

export function createContainer(id: string, className: string): HTMLElement {
  const container = document.createElement('div')
  container.className = `mu-root ${className}`
  container.setAttribute('data-mu-root', id)
  return container
}

function tokenList(attribute: string): string[] {
  return (document.documentElement.getAttribute(attribute) ?? '').split(/\s+/).filter((token) => token !== '')
}

function setToken(attribute: string, token: string, present: boolean): void {
  const tokens = tokenList(attribute).filter((item) => item !== token)
  if (present) {
    tokens.push(token)
  }
  if (tokens.length > 0) {
    document.documentElement.setAttribute(attribute, tokens.join(' '))
  } else {
    document.documentElement.removeAttribute(attribute)
  }
}

export class IslandRuntime {
  private readonly definitions = new Map<string, IslandDefinition>()
  private readonly mounted = new Map<string, Mounted>()
  /** Islands that threw while mounting: not retried on this page. */
  private readonly broken = new Set<string>()
  private readonly remounts = new Map<string, number>()
  private observer: MutationObserver | null = null
  private frame: number | null = null
  private started = false
  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      this.check()
    }
  }

  /** Mount operations so far (diagnostics and tests: repeated checks must not mount again). */
  mountCount = 0

  register(definition: IslandDefinition): void {
    if (!this.definitions.has(definition.id)) {
      this.definitions.set(definition.id, definition)
      if (this.started) {
        this.check()
      }
    }
  }

  /** Mounts what the screen offers and starts watching for re-rendered parts; idempotent. */
  start(options: { watch: boolean } = { watch: true }): void {
    if (this.started) {
      return
    }
    this.started = true
    this.check()
    if (options.watch && typeof MutationObserver === 'function') {
      this.observer = new MutationObserver((records) => {
        if (records.some((record) => record.type === 'childList' && (record.removedNodes.length > 0 || record.addedNodes.length > 0))) {
          this.schedule()
        }
      })
      this.observer.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('pageshow', this.onPageShow)
    }
  }

  /** Unmounts every island and stops watching (standard view, failed start). */
  stop(): void {
    this.started = false
    this.observer?.disconnect()
    this.observer = null
    window.removeEventListener('pageshow', this.onPageShow)
    if (this.frame !== null) {
      window.cancelAnimationFrame(this.frame)
      this.frame = null
    }
    for (const id of [...this.mounted.keys()]) {
      this.unmount(id)
    }
  }

  mountedIds(): string[] {
    return [...this.mounted.keys()]
  }

  /** Unmounts islands whose container left the page, mounts registered islands whose place is available. */
  check(): void {
    for (const [id, island] of [...this.mounted]) {
      if (!island.container.isConnected) {
        this.unmount(id)
      }
    }
    if (!this.started) {
      return
    }
    for (const definition of this.definitions.values()) {
      if (!this.mounted.has(definition.id) && !this.broken.has(definition.id)) {
        this.mount(definition)
      }
    }
  }

  private schedule(): void {
    if (this.frame !== null) {
      return
    }
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null
      this.check()
    })
  }

  private mount(definition: IslandDefinition): void {
    const { id } = definition
    const seen = this.remounts.get(id) ?? 0
    if (seen > MOUNT_LIMIT) {
      return
    }
    let place: IslandPlace | null
    try {
      place = definition.place()
    } catch (error) {
      console.warn(`[ModernUI] island ${id}: capability check failed`, error)
      this.broken.add(id)
      return
    }
    if (place === null) {
      return
    }
    if (seen === MOUNT_LIMIT) {
      this.remounts.set(id, seen + 1)
      console.warn(`[ModernUI] island ${id}: its container keeps disappearing, the island is not mounted again on this page`)
      return
    }
    const owns = place.kind === 'insert'
    let container: HTMLElement
    if (place.kind === 'insert') {
      container = createContainer(id, place.className)
      place.parent.insertBefore(container, place.before)
    } else {
      container = place.container
      if (container.querySelector('[data-v-app]') !== null || container.hasAttribute('data-v-app')) {
        // Something already mounted Vue here (a second copy of the entry): never mount twice.
        return
      }
    }
    const scope = new Scope(id)
    let app: App | null = null
    try {
      app = definition.create(scope)
      app.config.errorHandler = (error) => {
        console.warn(`[ModernUI] island ${id}:`, error)
      }
      app.mount(container)
    } catch (error) {
      console.warn(`[ModernUI] island ${id} could not be mounted:`, error)
      this.broken.add(id)
      try {
        app?.unmount()
      } catch {
        // nothing was mounted
      }
      scope.dispose()
      if (owns) {
        container.remove()
      }
      return
    }
    this.mounted.set(id, { definition, app, container, owns, scope })
    this.remounts.set(id, seen + 1)
    this.mountCount++
    if (definition.replaces !== undefined) {
      setToken('data-mu-replaced', definition.replaces, true)
    }
    setToken('data-mu-islands', id, true)
  }

  private unmount(id: string): void {
    const island = this.mounted.get(id)
    if (island === undefined) {
      return
    }
    this.mounted.delete(id)
    // The original comes back first, then the replacement goes: there is never a moment without either.
    if (island.definition.replaces !== undefined) {
      setToken('data-mu-replaced', island.definition.replaces, false)
    }
    setToken('data-mu-islands', id, false)
    island.scope.dispose()
    try {
      island.app.unmount()
    } catch (error) {
      console.warn(`[ModernUI] island ${id}: unmount failed`, error)
    } finally {
      if (island.owns) {
        island.container.remove()
      }
    }
  }
}
