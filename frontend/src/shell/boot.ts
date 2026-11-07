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
import { createApp, shallowRef } from 'vue'
import { fetchBootstrap } from '../api/client'
import { ApiError } from '../api/guards'
import type { Bootstrap } from '../api/types'
import { detectPageLevel, hostReady } from '../adapters/v7/host'
import { coveredBy, scanMenu, type ExtraLink } from '../adapters/v7/appMenu'
import { pageContext } from '../adapters/v7/page'
import { createThemeI18n } from '../i18n'
import { createContainer, createScope, IslandRuntime, setReplaced } from '../boot/runtime'
import { applyTokens, clearTokens } from '../boot/tokens'
import { adapterScreenLevel, startAdapters, type RunningAdapters } from '../boot/adapters'
import { CLIENT_ADAPTERS } from '../adapters/ext'
import SystemMenu from './SystemMenu.vue'
import MegaMenu from './MegaMenu.vue'
import FavoritesBar from './FavoritesBar.vue'
import ModuleRail from './ModuleRail.vue'
import Brand from './Brand.vue'
import { createFavorites, type FavoritesStore } from './nav/favorites'
import { currentGroup } from './nav/model'
import { startRecordOverlay, supportsRecordOverlay } from '../record/overlay'

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
/** Client parts of the adapters of extensions running on this page. */
let adapters: RunningAdapters | null = null
/** The record over the list of a screen with the cloud layout (docs/architecture.md A15). */
let recordOverlay: ReturnType<typeof createScope> | null = null

function stopRecordOverlay(): void {
  recordOverlay?.dispose()
  recordOverlay = null
}

function stopAdapters(): void {
  adapters?.stop()
  adapters = null
}

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
  const favorites = createFavorites(data)
  runtime.register({
    id: 'system-menu',
    // With the favorites bar: at its right end (own container of the fixed header), so the row of v7 actions keeps the
    // width v7 gives it. Without it: next to the v7 actions, never inside a foreign <ul> (extensions use #navbar li:eq(0)).
    place: () => {
      const header = document.querySelector('#page > nav.app-fixed-navbar')
      if (favorites.visible && header !== null) {
        overlayRoot()
        return { kind: 'insert', parent: header, before: null, className: 'mu-system-menu mu-system-menu--bar' }
      }
      const navbar = document.getElementById('navbar')
      if (navbar?.closest('nav.app-fixed-navbar') == null) {
        return null
      }
      overlayRoot()
      return { kind: 'insert', parent: navbar, before: navbar.firstChild, className: 'mu-system-menu' }
    },
    create: () => createApp(SystemMenu, { bootstrap: data, onStandardView: teardown }).use(i18n),
  })
  registerNavigation(data, i18n, favorites)
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

/** Height of the favorites bar: the same variable the tokens stylesheet reserves from the first paint. */
const BAR_VARIABLE = '--mu-favorites-bar'

/**
 * Navigation of the theme (docs/design.md §5.1, docs/architecture.md §7.1): the mega menu instead of the v7 app
 * menu, the favorites bar above the header and the module rail of the current section instead of the v7 strip.
 * A v7 original is hidden only when the theme covers all of its entries; links the theme menu does not have stay
 * reachable in the mega menu, and an entry without a link (a button of an extension) keeps the original visible.
 */
function registerNavigation(data: Bootstrap, i18n: ReturnType<typeof createThemeI18n>, favorites: FavoritesStore): void {
  const page = pageContext()
  const covered = coveredBy(data.menu.modules, data.user.isAdmin, [...data.menu.entries, ...data.menu.groups.flatMap((group) => group.items.map((entry) => entry.url))])
  const extras = shallowRef<readonly ExtraLink[]>([])
  let appMenuForeign = false

  const scanAppMenu = (): void => {
    const menu = document.getElementById('app-menu')
    const scan = menu !== null ? scanMenu(menu, covered) : { extras: [], foreign: [] }
    extras.value = scan.extras
    const foreign = scan.foreign.length > 0
    if (foreign && !appMenuForeign) {
      console.info(`[ModernUI] the v7 app menu has entries without a link (${scan.foreign.slice(0, 5).join(', ')}): its button stays visible`)
    }
    appMenuForeign = foreign
  }

  // The tokens stylesheet reserved the bar from the settings; this is what the shell really shows.
  document.documentElement.style.setProperty(BAR_VARIABLE, favorites.visible ? '42px' : '0px')

  runtime.register({
    id: 'mega-menu',
    // In place of the v7 hamburger; on a header without it, next to the system menu.
    place: () => {
      const navigator = document.getElementById('appnavigator')
      const row = navigator?.parentElement ?? null
      if (navigator !== null && row !== null && navigator.closest('nav.app-fixed-navbar') !== null) {
        overlayRoot()
        scanAppMenu()
        return { kind: 'insert', parent: row, before: navigator, className: 'mu-mega-root' }
      }
      const navbar = document.getElementById('navbar')
      if (navbar?.closest('nav.app-fixed-navbar') == null) {
        return null
      }
      overlayRoot()
      scanAppMenu()
      return { kind: 'insert', parent: navbar, before: navbar.firstChild, className: 'mu-mega-root mu-mega-root--navbar' }
    },
    replaces: () => (appMenuForeign || document.getElementById('appnavigator') === null ? null : 'app-menu'),
    create: (scope) => {
      const menu = document.getElementById('app-menu')
      if (menu !== null) {
        // Extensions may add entries later: the extra links follow, an entry without a link brings the v7 button back.
        scope.observe(menu, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-default-url', 'onclick'] }, () => {
          scanAppMenu()
          setReplaced('app-menu', !appMenuForeign)
        })
      }
      return createApp(MegaMenu, { bootstrap: data, favorites, extras, onStandardView: teardown }).use(i18n)
    },
  })

  if (favorites.visible) {
    runtime.register({
      id: 'favorites',
      // First in the fixed header of v7, in the space the stylesheet reserved above its rows.
      place: () => {
        const nav = document.querySelector('#page > nav.app-fixed-navbar')
        if (nav === null) {
          return null
        }
        overlayRoot()
        return { kind: 'insert', parent: nav, before: nav.firstChild, className: 'mu-favorites-root' }
      },
      create: () => createApp(FavoritesBar, { bootstrap: data, favorites }).use(i18n),
    })
  }

  const group = currentGroup(data.menu.groups, page)
  // The capability check runs again after every re-render of the page: tell about a kept v7 strip once per page.
  let railNoticeShown = false
  if (data.layout.modules.includes(page.module) && page.view === 'List') {
    // Cloud layout (docs/architecture.md A15): the tokens stylesheet removes the rail of this screen from the first paint.
    // Entries the theme menu does not cover bring the v7 rail back (html[data-mu-keep-rail]).
    const strip = document.querySelector('#modnavigator > .mod-switcher-container')
    const scan = strip !== null ? scanMenu(strip, covered) : { extras: [], foreign: [] }
    if (scan.foreign.length > 0 || scan.extras.length > 0) {
      document.documentElement.setAttribute('data-mu-keep-rail', '')
      console.info('[ModernUI] the v7 module strip has entries the theme menu does not cover: it stays on this screen')
    }
  } else if (group !== null) {
    runtime.register({
      id: 'module-rail',
      place: () => {
        const rail = document.getElementById('modnavigator')
        const strip = rail?.querySelector(':scope > .mod-switcher-container') ?? null
        if (rail === null || strip === null) {
          return null
        }
        const scan = scanMenu(strip, covered)
        if (scan.foreign.length > 0 || scan.extras.length > 0) {
          if (!railNoticeShown) {
            railNoticeShown = true
            console.info('[ModernUI] the v7 module strip has entries the theme menu does not cover: it stays as it is')
          }
          return null
        }
        return { kind: 'insert', parent: rail, before: strip, className: 'mu-rail-root hidden-xs hidden-sm' }
      },
      replaces: 'module-rail',
      create: () => createApp(ModuleRail, { group, page }).use(i18n),
    })
  }
}

function removeMarkers(): void {
  const html = document.documentElement
  html.classList.remove(READY_CLASS, 'mu-pending')
  html.removeAttribute('data-mu-level')
  html.removeAttribute('data-mu-keep-rail')
  html.style.removeProperty(BAR_VARIABLE)
  document.getElementById('mu-overlay-root')?.remove()
}

/**
 * Removes everything the theme added to this page: islands, overlay root, tokens, markers, our stylesheets.
 * Used after "switch to the standard view".
 */
export function teardown(): void {
  stopRecordOverlay()
  stopAdapters()
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
    // A screen rule of an adapter keeps the screen of an extension at the stylesheet only (its own page shell, scripts
    // that rebuild the header); "standard" screens get no theme from the server at all.
    const page = pageContext()
    const ruled = adapterScreenLevel(data.adapters, page)
    const level = ruled === null ? detectPageLevel() : 'skin'
    html.setAttribute('data-mu-level', level)
    if (level === 'islands') {
      const i18n = createThemeI18n(data.locale.effective)
      registerIslands(data, i18n)
      runtime.start()
      html.classList.add(READY_CLASS)
      if (supportsRecordOverlay(page.module, page.view, data.layout.modules)) {
        recordOverlay = createScope('record-overlay')
        startRecordOverlay(recordOverlay, page.module, { fallback: i18n.global.t('record.fallback') })
      }
    }
    dispatch('mu:ready', level)
    // Adapters of the active extensions: after the islands, each in its own scope; a failing one is only logged.
    adapters = await startAdapters(data.adapters, page, CLIENT_ADAPTERS)
  } catch (error) {
    const code = error instanceof BootError ? error.code : error instanceof ApiError ? error.code : 'shell-error'
    stopRecordOverlay()
    stopAdapters()
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
