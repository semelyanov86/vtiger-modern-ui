/**
 * Controlled start of the shell (docs/architecture.md §5.3, §11):
 * host ready → authorised configuration (Bootstrap) → build and activity check → tokens → islands →
 * html.mu-shell-ready + "mu:ready" for the loader. Any failure unmounts what was mounted, removes the markers
 * and reports "mu:failed": the standard v7 interface stays usable.
 */
import { createApp } from 'vue'
import { fetchBootstrap } from '../api/client'
import { ApiError } from '../api/guards'
import type { Bootstrap } from '../api/types'
import { hostReady } from '../adapters/v7/host'
import { createThemeI18n } from '../i18n'
import { createContainer, mountIsland, unmountAll } from '../boot/islands'
import { applyTokens, cacheTokens, clearTokens, tokensFor } from '../boot/tokens'
import SystemMenu from './SystemMenu.vue'

const READY_CLASS = 'mu-shell-ready'
const OFF_CLASS = 'mu-off'

class BootError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'BootError'
    this.code = code
  }
}

let appliedTokens: Record<string, string> = {}

function dispatch(name: 'mu:ready' | 'mu:failed', detail?: string): void {
  document.dispatchEvent(new CustomEvent(name, { detail }))
}

/** Container for overlays (dropdowns, dialogs) of the islands: inside .mu-root, never directly in body. */
function overlayRoot(): HTMLElement {
  const existing = document.getElementById('mu-overlay-root')
  if (existing !== null) {
    return existing
  }
  const root = createContainer('overlay', 'mu-overlay-root')
  root.id = 'mu-overlay-root'
  document.body.appendChild(root)
  return root
}

function mountSystemMenu(data: Bootstrap, i18n: ReturnType<typeof createThemeI18n>): void {
  // Our own container next to the v7 actions: never inside a foreign <ul> (extensions use #navbar li:eq(0)).
  const navbar = document.getElementById('navbar')
  if (navbar === null) {
    return
  }
  const container = createContainer('system-menu', 'mu-system-menu')
  navbar.insertBefore(container, navbar.firstChild)
  overlayRoot()
  mountIsland('system-menu', container, () => createApp(SystemMenu, { bootstrap: data, onStandardView: teardown }).use(i18n), true)
}

/**
 * Removes everything the theme added to this page: islands, overlay root, tokens, markers, our stylesheets.
 * Used after "switch to the standard view" and when the start fails.
 */
export function teardown(): void {
  const html = document.documentElement
  unmountAll()
  document.getElementById('mu-overlay-root')?.remove()
  clearTokens(appliedTokens)
  appliedTokens = {}
  html.classList.remove(READY_CLASS, 'mu-pending')
  html.classList.add(OFF_CLASS)
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (link.dataset['muAsset'] === 'shell' || link.href.includes('/modules/ModernUI/resources/dist/assets/skin-')) {
      link.remove()
    }
  }
}

export async function boot(): Promise<void> {
  const html = document.documentElement
  const expectedBuild = html.dataset['muBuild'] ?? ''
  try {
    await hostReady()
    const data = await fetchBootstrap()
    if (data.build === '' || data.build !== expectedBuild) {
      throw new BootError('build-mismatch')
    }
    if (!data.theme.active) {
      throw new BootError(`inactive:${data.theme.reason}`)
    }
    appliedTokens = tokensFor(data.appearance)
    applyTokens(appliedTokens)
    cacheTokens(data.theme.cacheKey, appliedTokens)
    html.setAttribute('data-mu-locale', data.locale.effective)
    mountSystemMenu(data, createThemeI18n(data.locale.effective))
    html.classList.add(READY_CLASS)
    dispatch('mu:ready')
  } catch (error) {
    const code = error instanceof BootError ? error.code : error instanceof ApiError ? error.code : 'shell-error'
    unmountAll()
    document.getElementById('mu-overlay-root')?.remove()
    html.classList.remove(READY_CLASS)
    if (error instanceof BootError || error instanceof ApiError) {
      console.warn(`[ModernUI] ${error.message}`)
    } else {
      console.warn('[ModernUI] the shell failed to start:', error)
    }
    dispatch('mu:failed', code)
  }
}
