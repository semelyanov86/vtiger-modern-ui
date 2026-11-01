/**
 * Registry of the Vue islands (docs/architecture.md §6, §7.3). An island is a Vue app in a container that
 * belongs to ModernUI ([data-mu-root]); it never mounts on body, #page or DOM managed by jQuery. Every
 * island is isolated: an exception while mounting one unmounts it and does not touch the others or v7.
 */
import type { App } from 'vue'

interface Island {
  readonly id: string
  readonly app: App
  readonly container: HTMLElement
  /** Remove the container on unmount when ModernUI created it (not when the server rendered it). */
  readonly ownsContainer: boolean
}

const islands = new Map<string, Island>()

export function createContainer(id: string, extraClass: string): HTMLElement {
  const container = document.createElement('div')
  container.className = `mu-root ${extraClass}`
  container.setAttribute('data-mu-root', id)
  return container
}

/**
 * Mounts an app into a container. Returns false (and leaves nothing behind) when mounting throws.
 */
export function mountIsland(id: string, container: HTMLElement, createApp: () => App, ownsContainer: boolean): boolean {
  if (islands.has(id)) {
    return true
  }
  let app: App | null = null
  try {
    app = createApp()
    app.config.errorHandler = (error) => {
      console.warn(`[ModernUI] island ${id}:`, error)
    }
    app.mount(container)
    islands.set(id, { id, app, container, ownsContainer })
    return true
  } catch (error) {
    console.warn(`[ModernUI] island ${id} could not be mounted:`, error)
    try {
      app?.unmount()
    } catch {
      // nothing mounted
    }
    if (ownsContainer) {
      container.remove()
    }
    return false
  }
}

export function unmountIsland(id: string): void {
  const island = islands.get(id)
  if (island === undefined) {
    return
  }
  islands.delete(id)
  try {
    island.app.unmount()
  } finally {
    if (island.ownsContainer) {
      island.container.remove()
    }
  }
}

export function unmountAll(): void {
  for (const id of [...islands.keys()]) {
    unmountIsland(id)
  }
}

export function mountedIslands(): string[] {
  return [...islands.keys()]
}
