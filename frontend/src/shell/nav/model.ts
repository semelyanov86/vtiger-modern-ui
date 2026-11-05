/**
 * Navigation of the shell over the menu the server built (docs/settings.md §6.2, docs/design.md §5.1): the section
 * (group) of the current page, the search of modules and the items of a module. Pure functions, unit-tested.
 */
import type { Menu, MenuGroup, MenuItem } from '../../api/types'
import type { PageContext } from '../../adapters/v7/page'

/**
 * The group of the current page: the group of the v7 app in the URL that has the module, then any group with it, then
 * the group of the app of the URL.
 */
export function currentGroup(groups: readonly MenuGroup[], page: PageContext): MenuGroup | null {
  if (page.module === '') {
    return null
  }
  const has = (group: MenuGroup): boolean => group.items.some((item) => item.module === page.module)
  if (page.app !== '') {
    const ofApp = groups.find((group) => group.app === page.app && has(group))
    if (ofApp !== undefined) {
      return ofApp
    }
  }
  // A module the menu hides (or one outside the menu): the section of the v7 app of the URL, without it.
  return groups.find(has) ?? (page.app !== '' ? groups.find((group) => group.app === page.app) ?? null : null)
}

/** Is this entry the page the user is on? Module entries by module; links to a view also by the view. */
export function isCurrent(item: MenuItem, page: PageContext): boolean {
  if (item.module !== page.module || page.parent === 'Settings') {
    return false
  }
  if (item.id.startsWith('r:')) {
    const view = new URLSearchParams(item.url.replace(/^index\.php\?/, '')).get('view') ?? ''
    return view === page.view
  }
  return true
}

/** The entry of a module in the menu (first group that has it), for the favorites. */
export function moduleItem(menu: Pick<Menu, 'groups' | 'favorites'>, module: string): MenuItem | null {
  for (const group of menu.groups) {
    const item = group.items.find((entry) => entry.module === module && entry.id === `m:${module}`)
    if (item !== undefined) {
      return item
    }
  }
  return menu.favorites.find((entry) => entry.module === module) ?? null
}

/**
 * Text for comparisons of the search: lower case, without accents and with the usual equivalents, so that
 * "grosse" finds "Größe", "ё" and "е" are the same letter, and "Ubersicht" finds "Übersicht".
 */
export function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ё/g, 'е')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface SearchResult {
  readonly item: MenuItem
  readonly group: MenuGroup
}

/**
 * Modules whose label, group label or system name contains every word of the query; each module once (the first
 * group that has it), labels that start with the query first, then the menu order.
 */
export function searchMenu(groups: readonly MenuGroup[], query: string): SearchResult[] {
  const words = normalize(query).split(' ').filter((word) => word !== '')
  if (words.length === 0) {
    return []
  }
  const seen = new Set<string>()
  const results: { result: SearchResult; starts: boolean; order: number }[] = []
  for (const group of groups) {
    const groupText = normalize(group.label)
    for (const item of group.items) {
      const key = `${item.id}|${item.module}`
      if (seen.has(key)) {
        continue
      }
      const label = normalize(item.label)
      const haystack = `${label} ${groupText} ${item.module.toLowerCase()}`
      if (words.every((word) => haystack.includes(word))) {
        seen.add(key)
        results.push({ result: { item, group }, starts: label.startsWith(words[0] ?? ''), order: results.length })
      }
    }
  }
  results.sort((a, b) => Number(b.starts) - Number(a.starts) || a.order - b.order)
  return results.map((entry) => entry.result)
}
