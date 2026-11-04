/**
 * Controlled start of the shell (docs/architecture.md §5.3, §7.3, §11):
 * host ready → authorised configuration (Bootstrap) → build and activity check → tokens → level of the page →
 * islands → html.mu-shell-ready + "mu:ready" for the loader. Any failure stops the runtime, removes what was
 * mounted and the markers, and reports "mu:failed": the standard v7 interface stays usable, with the skin.
 *
 * Levels of a page (html[data-mu-level]): "islands" — the v7 layout is recognised, the Vue islands mount into
 * their own containers; "skin" — an unknown page shell, only the stylesheet applies. The standard view (no
 * theme at all) is html.mu-off or a page the server printed without the theme links.
 */
// createApp() of imported single-file components, not components defined here.
/* eslint-disable vue/one-component-per-file */
import { createApp } from 'vue'
import { fetchBootstrap } from '../api/client'
import { ApiError } from '../api/guards'
import type { Bootstrap } from '../api/types'
import { detectPageLevel, hostReady } from '../adapters/v7/host'
import { createThemeI18n } from '../i18n'
import { createContainer, IslandRuntime } from '../boot/runtime'
import { applyTokens, clearTokens } from '../boot/tokens'
import SystemMenu from './SystemMenu.vue'
import NavigationMenu from './NavigationMenu.vue'
import Brand from './Brand.vue'

const READY_CLASS = 'mu-shell-ready'
const OFF_CLASS = 'mu-off'
/** Set once per page: a second copy of the entry (or a second loader) does not start a second shell. */
const RUNTIME_ATTRIBUTE = 'data-mu-runtime'

class BootError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'BootError'
    this.code = code
  }
}

const runtime = new IslandRuntime()

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

function registerIslands(data: Bootstrap, i18n: ReturnType<typeof createThemeI18n>): void {
  runtime.register({
    id: 'system-menu',
    // Our own container next to the v7 actions: never inside a foreign <ul> (extensions use #navbar li:eq(0)).
    place: () => {
      const navbar = document.getElementById('navbar')
      if (navbar?.closest('nav.app-fixed-navbar') == null) {
        return null
      }
      overlayRoot()
      return { kind: 'insert', parent: navbar, before: navbar.firstChild, className: 'mu-system-menu' }
    },
    create: () => createApp(SystemMenu, { bootstrap: data, onStandardView: teardown }).use(i18n),
  })
  runtime.register({
    id: 'navigation',
    // Next to the system menu (floats right: placed after it in the DOM, it stands to its left).
    place: () => {
      const navbar = document.getElementById('navbar')
      if (navbar?.closest('nav.app-fixed-navbar') == null || (data.menu.groups.length === 0 && data.menu.favorites.length === 0)) {
        return null
      }
      overlayRoot()
      const system = navbar.querySelector(':scope > [data-mu-root="system-menu"]')
      return { kind: 'insert', parent: navbar, before: system !== null ? system.nextSibling : navbar.firstChild, className: 'mu-navigation-root' }
    },
    create: () => createApp(NavigationMenu, { menu: data.menu }).use(i18n),
  })
  const branding = data.branding
  if (branding.logoUrl !== null || branding.title !== null) {
    const brand = {
      id: 'brand',
      // Inside the company logo link of the v7 header, after its image (the red marks extensions put there stay).
      place: () => {
        const anchor = document.querySelector('nav.app-fixed-navbar .logo-container a.company-logo')
        if (anchor === null) {
          return null
        }
        const image = anchor.querySelector(':scope > img')
        return { kind: 'insert' as const, parent: anchor, before: image !== null ? image.nextSibling : anchor.firstChild, className: 'mu-brand-root' }
      },
      create: () => createApp(Brand, { branding }).use(i18n),
    }
    runtime.register(branding.logoUrl !== null ? { ...brand, replaces: 'logo' } : brand)
  }
}

function removeMarkers(): void {
  const html = document.documentElement
  html.classList.remove(READY_CLASS, 'mu-pending')
  html.removeAttribute('data-mu-level')
  document.getElementById('mu-overlay-root')?.remove()
}

/**
 * Removes everything the theme added to this page: islands, overlay root, tokens, markers, our stylesheets.
 * Used after "switch to the standard view".
 */
export function teardown(): void {
  runtime.stop()
  clearTokens()
  removeMarkers()
  document.documentElement.classList.add(OFF_CLASS)
  for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    const href = link.getAttribute('href') ?? ''
    if (link.dataset['muAsset'] === 'shell' || href.includes('/modules/ModernUI/resources/dist/assets/skin-')
      || href.includes('module=ModernUI&action=Tokens')) {
      link.remove()
    }
  }
}

export async function boot(): Promise<void> {
  const html = document.documentElement
  if (html.hasAttribute(RUNTIME_ATTRIBUTE)) {
    return
  }
  html.setAttribute(RUNTIME_ATTRIBUTE, '1')
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
    // The tokens stylesheet already has these values; inline they also cover a failed or stale stylesheet.
    applyTokens(data.appearance.tokens)
    html.setAttribute('data-mu-locale', data.locale.effective)
    const level = detectPageLevel()
    html.setAttribute('data-mu-level', level)
    if (level === 'islands') {
      registerIslands(data, createThemeI18n(data.locale.effective))
      runtime.start()
      html.classList.add(READY_CLASS)
    }
    dispatch('mu:ready', level)
  } catch (error) {
    const code = error instanceof BootError ? error.code : error instanceof ApiError ? error.code : 'shell-error'
    runtime.stop()
    removeMarkers()
    if (error instanceof BootError || error instanceof ApiError) {
      console.warn(`[ModernUI] ${error.message}`)
    } else {
      console.warn('[ModernUI] the shell failed to start:', error)
    }
    dispatch('mu:failed', code)
  }
}
