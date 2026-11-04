/**
 * The menu configuration the editor changes (navigation.groups, docs/settings.md §6.1): groups → items, module items
 * and routes to a CRM view. The server validates the same shape again (ModernUI_Settings_Model::normalizeMenu); the
 * client only reads stored values leniently and writes the exact shape.
 */
import { isMenuIcon, type MenuIconName } from './icons'
import { isLabels, type Labels } from './labels'

export interface ModuleItemConfig {
  type: 'module'
  module: string
  label: Labels | null
  icon: MenuIconName | null
}

export type RouteParam = 'app' | 'viewname' | 'mode' | 'parent'

export interface RouteItemConfig {
  type: 'route'
  id: string
  label: Labels
  icon: MenuIconName | null
  route: { module: string; view: string; params: Partial<Record<RouteParam, string>> | null }
}

export type ItemConfig = ModuleItemConfig | RouteItemConfig

export interface GroupConfig {
  id: string
  source?: { app: string }
  label: Labels | null
  icon: MenuIconName | null
  collapsed: boolean
  items: ItemConfig[]
}

export const NAME = /^[A-Za-z0-9_]{1,50}$/
export const ID = /^[a-z0-9_-]{1,32}$/
export const PARAM_VALUE = /^[A-Za-z0-9_:-]{1,64}$/
export const GROUPS_MAX = 30
export const ITEMS_MAX = 100

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function labelsOf(value: unknown): Labels | null {
  return isLabels(value) && Object.keys(value).length > 0 ? { ...value } : null
}

function iconOf(value: unknown): MenuIconName | null {
  return isMenuIcon(value) ? value : null
}

function itemOf(value: unknown): ItemConfig | null {
  const item = record(value)
  if (item === null) {
    return null
  }
  if (item['type'] === 'module' && typeof item['module'] === 'string' && NAME.test(item['module'])) {
    return { type: 'module', module: item['module'], label: labelsOf(item['label']), icon: iconOf(item['icon']) }
  }
  const route = record(item['route'])
  const label = labelsOf(item['label'])
  if (item['type'] === 'route' && typeof item['id'] === 'string' && ID.test(item['id']) && route !== null && label !== null
    && typeof route['module'] === 'string' && NAME.test(route['module']) && typeof route['view'] === 'string' && NAME.test(route['view'])) {
    const params: Partial<Record<RouteParam, string>> = {}
    const source = record(route['params'])
    for (const key of ['app', 'viewname', 'mode', 'parent'] as const) {
      const param = source?.[key]
      if (typeof param === 'string' && PARAM_VALUE.test(param)) {
        params[key] = param
      }
    }
    return {
      type: 'route', id: item['id'], label, icon: iconOf(item['icon']),
      route: { module: route['module'], view: route['view'], params: Object.keys(params).length > 0 ? params : null },
    }
  }
  return null
}

/** A stored navigation.groups value; null when it is not a menu (the CRM menu applies). */
export function parseGroups(value: unknown): GroupConfig[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const groups: GroupConfig[] = []
  for (const entry of value) {
    const group = record(entry)
    if (group === null || typeof group['id'] !== 'string' || !ID.test(group['id']) || !Array.isArray(group['items'])) {
      continue
    }
    const source = record(group['source'])
    const items: ItemConfig[] = []
    for (const raw of group['items']) {
      const item = itemOf(raw)
      if (item !== null) {
        items.push(item)
      }
    }
    const parsed: GroupConfig = {
      id: group['id'],
      label: labelsOf(group['label']),
      icon: iconOf(group['icon']),
      collapsed: group['collapsed'] === true,
      items,
    }
    if (source !== null && typeof source['app'] === 'string' && /^[A-Z][A-Z_]{0,31}$/.test(source['app'])) {
      parsed.source = { app: source['app'] }
    }
    groups.push(parsed)
  }
  return groups
}

/** Deep copy (the configuration is plain JSON). */
export function cloneGroups(groups: readonly GroupConfig[]): GroupConfig[] {
  return JSON.parse(JSON.stringify(groups)) as GroupConfig[]
}

/** Modules placed by the configuration. */
export function mentionedModules(groups: readonly GroupConfig[]): Set<string> {
  const modules = new Set<string>()
  for (const group of groups) {
    for (const item of group.items) {
      if (item.type === 'module') {
        modules.add(item.module)
      }
    }
  }
  return modules
}

/** A new id for a group or a route that is not used yet. */
export function freshId(prefix: string, used: ReadonlySet<string>): string {
  for (let index = 1; index < 1000; index++) {
    const id = `${prefix}${String(index)}`
    if (!used.has(id)) {
      return id
    }
  }
  return `${prefix}${String(Date.now() % 100000)}`
}

/** Stable key of an item inside the editor (modules once per group, route ids unique). */
export function itemKey(item: ItemConfig): string {
  return item.type === 'module' ? `m:${item.module}` : `r:${item.id}`
}
