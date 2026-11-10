/**
 * State of the settings editor: the scope being edited (common settings or the profile of a role), its saved values,
 * the draft and the revision the draft is based on (optimistic locking, docs/settings.md §8). The draft lives in the
 * browser only until "Save"; "Cancel" returns to the saved values.
 *
 * Stage 16: the changes of a draft can be carried over to newer saved values (rebase) — after a conflict with another
 * save, or when a draft kept by this tab (sessionStorage, the page was reloaded or left) is restored — instead of
 * being lost; every key reports whether it is inherited or set in the scope (docs/settings.md §14).
 */
import { computed, reactive, shallowRef } from 'vue'
import type { EditorData, ScopeRef, Values } from './types'

export type SectionId = 'enable' | 'appearance' | 'menu' | 'access' | 'compatibility' | 'transfer' | 'maintenance'
export type DraftSection = Exclude<SectionId, 'transfer' | 'maintenance'>

/** Order of the sections on the page (docs/design.md §13.12): switching on first, service last. */
export const SECTIONS: readonly SectionId[] = ['enable', 'appearance', 'menu', 'access', 'compatibility', 'transfer', 'maintenance']

/** Sections that edit the profile of a role as well; the others belong to the common settings only. */
export const SCOPED_SECTIONS: readonly SectionId[] = ['appearance', 'menu', 'compatibility']

/** Keys each section edits. */
export const SECTION_KEYS: Readonly<Record<DraftSection, readonly string[]>> = {
  enable: [
    'theme.mode', 'theme.pilot.users', 'theme.pilot.roles', 'theme.pilot.includeSubordinates', 'theme.allowSelfEnable',
    'theme.allowOptOut',
  ],
  appearance: [
    'appearance.primaryColor', 'appearance.background', 'appearance.surface', 'appearance.density', 'appearance.fontScale',
    'appearance.font', 'branding.logo', 'branding.title', 'branding.noticeEnabled', 'branding.notice', 'locale.default',
  ],
  menu: ['navigation.groups', 'navigation.hidden', 'navigation.favoritesEnabled', 'navigation.compact'],
  access: ['policy.userOverrides'],
  compatibility: ['theme.excludedScreens', 'adapters.disabled'],
}

export function isDraftSection(section: SectionId): section is DraftSection {
  return section !== 'transfer' && section !== 'maintenance'
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

/**
 * Carries the changes of a draft over to other saved values: every key the draft changed against its base takes the
 * value of the draft (or is removed, as in the draft); keys the draft did not touch keep the new saved value. "overlap"
 * lists the keys changed on both sides (the draft wins there; the person reviews them before saving).
 */
export function rebaseValues(base: Values, draft: Values, current: Values): { values: Values; mine: string[]; overlap: string[] } {
  const mine = changedKeys(base, draft)
  const theirs = new Set(changedKeys(base, current))
  const values = clone(current)
  for (const key of mine) {
    if (Object.prototype.hasOwnProperty.call(draft, key)) {
      values[key] = clone(draft[key])
    } else {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete values[key]
    }
  }
  return { values, mine, overlap: mine.filter((key) => theirs.has(key) && !same(draft[key], current[key])) }
}

export interface Draft {
  scope: ScopeRef
  base: Values
  values: Values
  revision: number
  inherit: boolean
  baseInherit: boolean
}

/** A draft this tab keeps while it is not saved (sessionStorage): the page can be reloaded or left without losing it. */
export interface StoredDraft {
  readonly v: 1
  readonly scope: ScopeRef
  readonly revision: number
  readonly base: Values
  readonly values: Values
  readonly inherit: boolean
  readonly baseInherit: boolean
  readonly savedAt: string
}

export function scopeKey(scope: ScopeRef): string {
  return scope.kind === 'global' ? 'global' : `role:${scope.role}`
}

export function storageKey(me: number): string {
  return `modernui.settings.draft.${String(me)}`
}

function plainObject(value: unknown): value is Values {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A stored draft read back leniently: anything unexpected is ignored (the person just does not get it back). */
export function parseStoredDraft(text: string | null): StoredDraft | null {
  if (text === null) {
    return null
  }
  try {
    const value: unknown = JSON.parse(text)
    if (!plainObject(value) || value['v'] !== 1 || !plainObject(value['scope']) || !plainObject(value['base']) || !plainObject(value['values'])) {
      return null
    }
    const scope = value['scope']
    const ref: ScopeRef | null = scope['kind'] === 'global'
      ? { kind: 'global' }
      : scope['kind'] === 'role' && typeof scope['role'] === 'string' && /^H[0-9]{1,10}$/.test(scope['role']) ? { kind: 'role', role: scope['role'] } : null
    if (ref === null || typeof value['revision'] !== 'number' || typeof value['savedAt'] !== 'string') {
      return null
    }
    return {
      v: 1, scope: ref, revision: value['revision'], base: value['base'], values: value['values'],
      inherit: value['inherit'] === true, baseInherit: value['baseInherit'] === true, savedAt: value['savedAt'],
    }
  } catch {
    return null
  }
}

/** How a key stands in the scope being edited. */
export type KeyState =
  /** Common settings: not set, the value of the module applies. */
  | 'default'
  /** Common settings: set here. */
  | 'set'
  /** Role profile: not set, the common settings (or the module) apply. */
  | 'inherited'
  /** Role profile: set for the role. */
  | 'own'

export function createEditor(initial: EditorData) {
  const data = shallowRef<EditorData>(initial)
  const draft = reactive<Draft>({ scope: { kind: 'global' }, base: {}, values: {}, revision: 0, inherit: false, baseInherit: false })

  function saved(scope: ScopeRef): { values: Values; revision: number; inherit: boolean } {
    if (scope.kind === 'global') {
      return { values: data.value.global.values, revision: data.value.global.revision, inherit: false }
    }
    const profile = data.value.roles.find((role) => role.id === scope.role)?.profile ?? null
    return profile === null ? { values: {}, revision: 0, inherit: false } : { values: profile.values, revision: profile.revision, inherit: profile.inherit }
  }

  function open(scope: ScopeRef): void {
    const { values, revision, inherit } = saved(scope)
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
  const inheritDirty = computed(() => draft.inherit !== draft.baseInherit)
  const dirty = computed(() => dirtyKeys.value.length > 0 || inheritDirty.value)
  /** Number of changes of the draft (the keys, and the "subordinate roles too" switch of a role). */
  const changes = computed(() => dirtyKeys.value.length + (inheritDirty.value ? 1 : 0))

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

  /** The value of the module (the defaults of the code). */
  function defaultValue(key: string): unknown {
    return data.value.defaults[key]
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

  function keyState(key: string): KeyState {
    if (draft.scope.kind === 'role') {
      return has(key) ? 'own' : 'inherited'
    }
    return has(key) ? 'set' : 'default'
  }

  function sectionDirty(section: DraftSection): boolean {
    return SECTION_KEYS[section].some((key) => dirtyKeys.value.includes(key))
  }

  /** Keys of a section "Reset section" returns to the inherited values in this scope. */
  function resettable(section: DraftSection): string[] {
    return SECTION_KEYS[section].filter((key) => allowed(key) && !(draft.scope.kind === 'global' && NOT_RESET.has(key)))
  }

  /** Back to the inherited values for the keys of a section (common settings: the defaults; a role: the common settings). */
  function resetSection(section: DraftSection): void {
    for (const key of resettable(section)) {
      set(key, undefined)
    }
  }

  function cancel(): void {
    draft.values = clone(draft.base)
    draft.inherit = draft.baseInherit
  }

  /** New data from the server; the current scope is opened again with its saved values (the draft is dropped). */
  function replaceData(next: EditorData): void {
    data.value = next
    const scope = draft.scope
    if (scope.kind === 'role' && !next.roles.some((role) => role.id === scope.role)) {
      open({ kind: 'global' })
      return
    }
    open(scope)
  }

  /**
   * New data from the server with the changes of the draft carried over (a conflict: "apply my changes to the current
   * version"). The draft is then based on the current revision; returns the keys changed on both sides.
   */
  function rebase(next: EditorData): string[] {
    const before = { base: clone(draft.base), values: clone(draft.values), inherit: draft.inherit, baseInherit: draft.baseInherit }
    replaceData(next)
    const result = rebaseValues(before.base, before.values, draft.base)
    draft.values = result.values
    if (before.inherit !== before.baseInherit) {
      draft.inherit = before.inherit
    }
    return result.overlap
  }

  /** The draft as this tab keeps it (null when there is nothing to keep). */
  function snapshot(): StoredDraft | null {
    if (!dirty.value) {
      return null
    }
    return {
      v: 1, scope: draft.scope, revision: draft.revision, base: clone(draft.base), values: clone(draft.values),
      inherit: draft.inherit, baseInherit: draft.baseInherit, savedAt: new Date().toISOString(),
    }
  }

  /**
   * Restores a kept draft over the current saved values of its scope. Returns null when its scope no longer exists,
   * otherwise whether the settings were saved again since (the draft is then carried over, as after a conflict).
   */
  function restore(stored: StoredDraft): { changed: boolean; overlap: string[] } | null {
    const scope = stored.scope
    if (scope.kind === 'role' && !data.value.roles.some((role) => role.id === scope.role && !role.missing)) {
      return null
    }
    open(scope)
    const result = rebaseValues(stored.base, stored.values, draft.base)
    draft.values = result.values
    if (stored.inherit !== stored.baseInherit) {
      draft.inherit = stored.inherit
    }
    return { changed: stored.revision !== draft.revision, overlap: stored.revision !== draft.revision ? result.overlap : [] }
  }

  return {
    data, draft, isRole, dirty, dirtyKeys, changes, allowed, has, get, set, defaultValue, inherited, effective, keyState,
    sectionDirty, resettable, resetSection, cancel, open, replaceData, rebase, snapshot, restore,
  }
}

export type Editor = ReturnType<typeof createEditor>
