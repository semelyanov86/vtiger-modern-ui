/**
 * Where the user is on a v7 page (docs/architecture.md §7.1): module, view, parent and the app of the v7 menu.
 * Read from _META of Header.tpl (the same source extensions use through app.getModuleName()), with the query
 * string as the fallback. Only reads; nothing on the page changes.
 */
import { isRecord } from '../../api/guards'

export interface PageContext {
  readonly module: string
  readonly view: string
  readonly parent: string
  /** App of the v7 menu (MARKETING, SALES, …) or '' — _META.app comes with a leading space on some builds. */
  readonly app: string
}

const NAME = /^[A-Za-z0-9_]{1,50}$/

function clean(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return NAME.test(text) ? text : ''
}

export function pageContext(location: Pick<Location, 'search'> = window.location): PageContext {
  const meta = isRecord(window._META) ? window._META : {}
  const query = new URLSearchParams(location.search)
  const pick = (name: string): string => clean(meta[name]) || clean(query.get(name))
  return { module: pick('module'), view: pick('view'), parent: pick('parent'), app: pick('app').toUpperCase() }
}

/**
 * A link of the CRM as the menus of the theme accept it: "index.php?…" relative to the CRM. v7 writes some links as
 * "?module=…" or with the site URL in front; anything else (another origin, script URLs, "#") is null.
 */
export function crmLink(raw: string | null, base: string = document.baseURI): string | null {
  if (raw === null) {
    return null
  }
  const text = raw.trim()
  if (text === '' || text.startsWith('#') || /^(?:javascript|vbscript|data):/i.test(text)) {
    return null
  }
  let url: URL
  let root: URL
  try {
    url = new URL(text, base)
    root = new URL('index.php', base)
  } catch {
    return null
  }
  if (url.origin !== root.origin || (url.pathname !== root.pathname && url.pathname !== root.pathname.replace(/index\.php$/, ''))) {
    return null
  }
  const search = url.search.replace(/^\?/, '')
  const link = `index.php?${search}`
  return /^index\.php\?[A-Za-z0-9_=&%.:-]{1,300}$/.test(link) ? link : null
}

/** module/view/parent of a CRM link (crmLink()). */
export function linkTarget(link: string): { module: string; view: string; parent: string } {
  const query = new URLSearchParams(link.replace(/^index\.php\?/, ''))
  return { module: clean(query.get('module')), view: clean(query.get('view')), parent: clean(query.get('parent')) }
}
