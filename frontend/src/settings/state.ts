/**
 * State of the settings editor: the scope being edited (common settings or the profile of a role), its saved values,
 * the draft and the revision the draft is based on (optimistic locking, docs/settings.md §8). The draft lives in the
 * browser only until "Save"; "Cancel" returns to the saved values.
 */
import { computed, reactive, shallowRef } from 'vue'
import type { EditorData, ScopeRef, Values } from './types'

export type SectionId = 'appearance' | 'menu' | 'access' | 'compatibility' | 'transfer'

/** Keys each section edits. */
export const SECTION_KEYS: Readonly<Record<Exclude<SectionId, 'transfer'>, readonly string[]>> = {
  appearance: [
    'appearance.primaryColor', 'appearance.background', 'appearance.surface', 'appearance.density', 'appearance.fontScale',
    'appearance.font', 'branding.logo', 'branding.title', 'locale.default',
  ],
  menu: ['navigation.groups', 'navigation.hidden', 'navigation.favoritesEnabled', 'navigation.compact'],
  access: [
    'theme.mode', 'theme.pilot.users', 'theme.pilot.roles', 'theme.pilot.includeSubordinates', 'theme.allowSelfEnable',
    'theme.allowOptOut', 'policy.userOverrides',
  ],
  compatibility: ['theme.excludedScreens', 'adapters.disabled'],
}

/** "Reset section" never switches the theme off or empties the pilot (docs/settings.md §8: reset keeps theme.mode). */
const NOT_RESET = new Set(['theme.mode', 'theme.pilot.users', 'theme.pilot.roles'])

/** JSON with sorted object keys: equality of plain values regardless of the key order. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function same(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b)
}

export function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/** Keys whose values differ between two flat maps. */
export function changedKeys(before: Values, after: Values): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter((key) => !same(before[key], after[key])).sort()
}

export interface Draft {
  scope: ScopeRef
  base: Values
  values: Values
  revision: number
  inherit: boolean
  baseInherit: boolean
}

export function scopeKey(scope: ScopeRef): string {
  return scope.kind === 'global' ? 'global' : `role:${scope.role}`
}

export function createEditor(initial: EditorData) {
  const data = shallowRef<EditorData>(initial)
  const draft = reactive<Draft>({ scope: { kind: 'global' }, base: {}, values: {}, revision: 0, inherit: false, baseInherit: false })

  function open(scope: ScopeRef): void {
    let values: Values = {}
    let revision = 0
    let inherit = false
    if (scope.kind === 'global') {
      values = data.value.global.values
      revision = data.value.global.revision
    } else {
      const profile = data.value.roles.find((role) => role.id === scope.role)?.profile ?? null
      if (profile !== null) {
        values = profile.values
        revision = profile.revision
        inherit = profile.inherit
      }
    }
    draft.scope = scope
    draft.base = clone(values)
    draft.values = clone(values)
    draft.revision = revision
    draft.inherit = inherit
    draft.baseInherit = inherit
  }

  open({ kind: 'global' })

  const isRole = computed(() => draft.scope.kind === 'role')
  const dirtyKeys = computed(() => changedKeys(draft.base, draft.values))
  const dirty = computed(() => dirtyKeys.value.length > 0 || draft.inherit !== draft.baseInherit)

  /** Whether the current scope may hold a key (role profiles hold a part of the schema). */
  function allowed(key: string): boolean {
    return (data.value.scopes[key] ?? []).includes(draft.scope.kind)
  }

  function has(key: string): boolean {
    // "in" goes through the has() trap of the reactive proxy, so computed values depending on a key that is added or
    // removed later update (Object.prototype.hasOwnProperty.call() on a proxy is not tracked by Vue).
    return key in draft.values
  }

  function get(key: string): unknown {
    return draft.values[key]
  }

  function set(key: string, value: unknown): void {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete draft.values[key]
    } else {
      draft.values[key] = value
    }
  }

  /** The value this scope inherits: the saved common settings for a role profile, the defaults for the common ones. */
  function inherited(key: string): unknown {
    if (draft.scope.kind === 'role' && Object.prototype.hasOwnProperty.call(data.value.global.values, key)) {
      return data.value.global.values[key]
    }
    return data.value.defaults[key]
  }

  /** Value that applies with the draft: the draft value or the inherited one. */
  function effective(key: string): unknown {
    return has(key) ? get(key) : inherited(key)
  }

  function sectionDirty(section: Exclude<SectionId, 'transfer'>): boolean {
    return SECTION_KEYS[section].some((key) => dirtyKeys.value.includes(key)) || (section === 'access' && draft.inherit !== draft.baseInherit)
  }

  /** Back to the inherited values for the keys of a section (common settings: the defaults; a role: the common settings). */
  function resetSection(section: Exclude<SectionId, 'transfer'>): void {
    for (const key of SECTION_KEYS[section]) {
      if (allowed(key) && !(draft.scope.kind === 'global' && NOT_RESET.has(key))) {
        set(key, undefined)
      }
    }
  }

  function cancel(): void {
    draft.values = clone(draft.base)
    draft.inherit = draft.baseInherit
  }

  /** New data from the server; the current scope is opened again with its saved values. */
  function replaceData(next: EditorData): void {
    data.value = next
    const scope = draft.scope
    if (scope.kind === 'role' && !next.roles.some((role) => role.id === scope.role)) {
      open({ kind: 'global' })
      return
    }
    open(scope)
  }

  return { data, draft, isRole, dirty, dirtyKeys, allowed, has, get, set, inherited, effective, sectionDirty, resetSection, cancel, open, replaceData }
}

export type Editor = ReturnType<typeof createEditor>
