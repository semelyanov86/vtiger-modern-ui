/**
 * The v7 navigation that the shell of the theme replaces (docs/architecture.md §7.1): the app menu (#app-menu,
 * opened by #appnavigator) and the module strip on the left (#modnavigator). Before a v7 element is hidden, its
 * entries are compared with the menu of the theme:
 *
 * - a link to a module the theme menu covers (every module the user may open, hidden ones included) needs nothing;
 * - any other link (added by an extension, the extension store of the core) is kept as an ordinary link of the mega
 *   menu with the same href and the label v7 shows — not an invisible duplicate;
 * - an interactive element without a link (a button with a handler of an extension) means the v7 element must stay
 *   visible: the scan reports it and the shell does not hide the original.
 *
 * Read-only: nothing in the v7 DOM is changed, moved or cloned.
 */
import { crmLink, linkTarget } from './page'

export interface ExtraLink {
  readonly label: string
  readonly url: string
}

export interface MenuScan {
  /** Links that the menu of the theme does not cover. */
  readonly extras: readonly ExtraLink[]
  /** Interactive elements without a link (descriptions for the console). */
  readonly foreign: readonly string[]
}

/** Interactive elements of a menu. */
const INTERACTIVE = 'a, button, input, select, textarea, [onclick], [data-default-url], [role="button"]'
/** Parts of the stock menus that are not entries: the app toggles of the app menu, the hamburger, scroll bars. */
const STRUCTURE = '#menu-toggle-action, .app-switcher-container, .app-navigator, .mCSB_scrollTools'

function describe(element: Element): string {
  const id = element.id !== '' ? `#${element.id}` : ''
  const classes = typeof element.className === 'string' && element.className.trim() !== '' ? `.${element.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''
  return `${element.tagName.toLowerCase()}${id}${classes}`
}

function labelOf(element: Element): string {
  const named = element.querySelector('.app-name, .module-name')
  const text = (named ?? element).textContent
  return text.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim().slice(0, 80)
}

function isStructure(element: Element): boolean {
  if (element.closest(STRUCTURE) !== null) {
    return true
  }
  // The app toggles of SidebarAppMenu.tpl: data-app-name with data-default-url="#".
  return element.matches('.app-item[data-app-name]') && (element.getAttribute('data-default-url') ?? '#') === '#'
}

/**
 * Entries of a v7 menu that the theme menu does not cover.
 * @param root the v7 menu (#app-menu or #modnavigator)
 * @param covered whether the theme already offers a CRM link (index.php?…)
 */
export function scanMenu(root: Element, covered: (link: string) => boolean): MenuScan {
  const extras: ExtraLink[] = []
  const foreign: string[] = []
  const seen = new Set<string>()
  for (const element of root.querySelectorAll(INTERACTIVE)) {
    if (isStructure(element)) {
      continue
    }
    // An element inside an entry that has its own URL belongs to that entry.
    const owner = element.parentElement?.closest('a[href], [data-default-url]:not([data-default-url="#"])') ?? null
    if (owner !== null && root.contains(owner)) {
      continue
    }
    const raw = element.matches('a[href]') ? element.getAttribute('href') : element.getAttribute('data-default-url')
    const link = crmLink(raw)
    if (link === null) {
      foreign.push(describe(element))
      continue
    }
    if (covered(link) || seen.has(link)) {
      continue
    }
    seen.add(link)
    const label = labelOf(element)
    extras.push({ label: label !== '' ? label : linkTarget(link).module, url: link })
  }
  return { extras, foreign }
}

/**
 * Views that open a module the way its menu entry does (Vtiger_Module_Model::getDefaultUrl() of the core and its
 * modules: lists, the dashboard, the calendar).
 */
const DEFAULT_VIEWS = new Set(['', 'List', 'Index', 'DashBoard', 'Calendar'])

/** Parameters of a menu link that do not change the destination: the app of the v7 menu. */
function destination(link: string): string {
  const query = new URLSearchParams(link.replace(/^index\.php\?/, ''))
  query.delete('app')
  query.sort()
  return query.toString()
}

/**
 * Whether the theme covers a CRM link: the entry of a module the user may open (its default view, or exactly the URL of
 * an entry of the theme menu), and the settings entries of the system section. Another view of a known module — the
 * shared calendar or the task list in the calendar strip of v7, a filter of a list — is not covered: the v7 element that
 * offers it stays (docs/architecture.md §7.1).
 * @param modules modules the user may open (Bootstrap menu.modules)
 * @param isAdmin
 * @param entries URLs of the entries of the theme menu (Bootstrap menu.groups[].items[].url)
 */
export function coveredBy(modules: readonly string[], isAdmin: boolean, entries: readonly string[] = []): (link: string) => boolean {
  const known = new Set(modules)
  const exact = new Set(entries.map(destination))
  return (link) => {
    const { module, view, parent } = linkTarget(link)
    if (parent === 'Settings') {
      return module === 'ModernUI' || (isAdmin && (module === 'Vtiger' || module === 'Users'))
    }
    if (module === '' || !known.has(module)) {
      return false
    }
    if (exact.has(destination(link))) {
      return true
    }
    const rest = new URLSearchParams(destination(link))
    rest.delete('module')
    rest.delete('view')
    return rest.toString() === '' && DEFAULT_VIEWS.has(view)
  }
}
