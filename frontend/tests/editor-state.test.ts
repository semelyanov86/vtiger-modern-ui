import { describe, expect, it } from 'vitest'
import { changedKeys, createEditor, parseStoredDraft, rebaseValues, stableJson } from '../src/settings/state'
import type { EditorData, ScopeData } from '../src/settings/types'

function scope(values: Record<string, unknown>, revision: number, inherit = false): ScopeData {
  return { values, revision, updatedAt: null, updatedBy: null, inherit, warnings: [] }
}

function data(): EditorData {
  return {
    v: 1, schema: 1, module: '0.3.0', me: 1,
    defaults: { 'theme.mode': 'off', 'appearance.density': 'standard', 'appearance.primaryColor': '#3978fe', 'theme.allowOptOut': true },
    scopes: {
      'theme.mode': ['global'], 'theme.pilot.users': ['global'], 'theme.allowOptOut': ['global'],
      'appearance.density': ['global', 'role', 'user'], 'appearance.primaryColor': ['global', 'role', 'user'],
    },
    userOverridable: ['locale'],
    global: scope({ 'theme.mode': 'pilot', 'theme.pilot.users': [1], 'theme.allowOptOut': false, 'appearance.density': 'compact' }, 4),
    roles: [
      { id: 'H5', name: 'Sales', parent: 'H2', path: ['Org', 'CEO', 'Sales'], depth: 2, users: 3, root: false, missing: false, profile: scope({ 'appearance.primaryColor': '#123456' }, 2, true) },
      { id: 'H6', name: 'Support', parent: 'H2', path: ['Org', 'CEO', 'Support'], depth: 2, users: 1, root: false, missing: false, profile: null },
    ],
    users: [], personal: [], catalog: { modules: [], defaultGroups: [] }, adapters: [], branding: { companyName: '', logoUrl: null },
  }
}

describe('draft of the settings editor', () => {
  it('compares values regardless of the key order', () => {
    expect(stableJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableJson({ a: [{ c: 3, d: 2 }], b: 1 }))
    expect(changedKeys({ a: 1, b: [1] }, { a: 1, b: [1, 2], c: true })).toEqual(['b', 'c'])
  })

  it('tracks changes, cancels them and never resets the mode or the pilot with a section reset', () => {
    const editor = createEditor(data())
    expect(editor.dirty.value).toBe(false)
    editor.set('appearance.density', 'comfortable')
    expect(editor.dirtyKeys.value).toEqual(['appearance.density'])
    expect(editor.sectionDirty('appearance')).toBe(true)
    editor.cancel()
    expect(editor.dirty.value).toBe(false)
    expect(editor.get('appearance.density')).toBe('compact')

    editor.resetSection('enable')
    expect(editor.get('theme.mode')).toBe('pilot')
    expect(editor.get('theme.pilot.users')).toEqual([1])
    expect(editor.has('theme.allowOptOut')).toBe(false)
    expect(editor.effective('theme.allowOptOut')).toBe(true)
  })

  it('a role profile inherits the saved common values and sets only its own keys', () => {
    const editor = createEditor(data())
    editor.open({ kind: 'role', role: 'H6' })
    expect(editor.isRole.value).toBe(true)
    expect(editor.draft.revision).toBe(0)
    expect(editor.effective('appearance.density')).toBe('compact')
    expect(editor.allowed('theme.mode')).toBe(false)
    expect(editor.allowed('appearance.density')).toBe(true)
    editor.open({ kind: 'role', role: 'H5' })
    expect(editor.draft.inherit).toBe(true)
    expect(editor.effective('appearance.primaryColor')).toBe('#123456')
    editor.draft.inherit = false
    expect(editor.dirty.value).toBe(true)
    editor.resetSection('appearance')
    expect(editor.effective('appearance.primaryColor')).toBe('#3978fe')
  })
})

describe('stage 16: where a value comes from, carrying a draft over, the draft kept by the tab', () => {
  it('reports default / set in the common settings and inherited / own in a role profile', () => {
    const editor = createEditor(data())
    expect(editor.keyState('appearance.density')).toBe('set')
    expect(editor.keyState('appearance.primaryColor')).toBe('default')
    expect(editor.defaultValue('appearance.primaryColor')).toBe('#3978fe')
    editor.open({ kind: 'role', role: 'H5' })
    expect(editor.keyState('appearance.primaryColor')).toBe('own')
    expect(editor.keyState('appearance.density')).toBe('inherited')
    expect(editor.inherited('appearance.density')).toBe('compact')
    // Changing an inherited value makes it the role's own; removing it inherits again.
    editor.set('appearance.density', 'comfortable')
    expect(editor.keyState('appearance.density')).toBe('own')
    editor.set('appearance.density', undefined)
    expect(editor.keyState('appearance.density')).toBe('inherited')
    expect(editor.resettable('enable')).toEqual([])
  })

  it('carries the changes of a draft over to newer values and names the keys changed on both sides', () => {
    const base = { a: 1, b: 2, c: 3 }
    const draft = { a: 10, b: 2 }
    const current = { a: 5, b: 20, c: 3, d: 4 }
    const result = rebaseValues(base, draft, current)
    expect(result.values).toEqual({ a: 10, b: 20, d: 4 })
    expect(result.mine).toEqual(['a', 'c'])
    expect(result.overlap).toEqual(['a'])
  })

  it('rebases on a conflict: the saved values of the other save stay, the draft keeps its own changes', () => {
    const editor = createEditor(data())
    editor.set('appearance.density', 'comfortable')
    const next = data()
    const fresh = { ...next, global: { ...next.global, revision: 5, values: { ...next.global.values, 'theme.allowOptOut': true, 'appearance.density': 'standard' } } }
    const overlap = editor.rebase(fresh)
    expect(editor.draft.revision).toBe(5)
    expect(editor.get('theme.allowOptOut')).toBe(true)
    expect(editor.get('appearance.density')).toBe('comfortable')
    expect(overlap).toEqual(['appearance.density'])
    expect(editor.dirtyKeys.value).toEqual(['appearance.density'])
  })

  it('keeps a draft for the tab and restores it over the current values of its scope', () => {
    const editor = createEditor(data())
    expect(editor.snapshot()).toBeNull()
    editor.open({ kind: 'role', role: 'H6' })
    editor.set('appearance.density', 'comfortable')
    const kept = editor.snapshot()
    expect(kept?.scope).toEqual({ kind: 'role', role: 'H6' })
    const parsed = parseStoredDraft(JSON.stringify(kept))
    expect(parsed).toEqual(kept)
    expect(parseStoredDraft('{"v":1,"scope":{"kind":"role","role":"<x>"}}')).toBeNull()
    expect(parseStoredDraft('not json')).toBeNull()

    const reopened = createEditor(data())
    const restored = parsed === null ? null : reopened.restore(parsed)
    expect(restored).toEqual({ changed: false, overlap: [] })
    expect(reopened.draft.scope).toEqual({ kind: 'role', role: 'H6' })
    expect(reopened.get('appearance.density')).toBe('comfortable')
    expect(reopened.dirty.value).toBe(true)

    const gone = createEditor({ ...data(), roles: [] })
    expect(parsed === null ? 'x' : gone.restore(parsed)).toBeNull()
  })
})

describe('reactivity of the draft', () => {
  it('computed values follow a key that is added later (preview of the appearance)', async () => {
    const { computed, nextTick } = await import('vue')
    const editor = createEditor(data())
    editor.open({ kind: 'role', role: 'H6' })
    const primary = computed(() => editor.effective('appearance.primaryColor'))
    expect(primary.value).toBe('#3978fe')
    editor.set('appearance.primaryColor', '#0a7d4f')
    await nextTick()
    expect(primary.value).toBe('#0a7d4f')
    editor.set('appearance.primaryColor', undefined)
    expect(primary.value).toBe('#3978fe')
  })
})
