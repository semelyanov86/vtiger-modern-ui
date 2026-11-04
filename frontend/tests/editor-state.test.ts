import { describe, expect, it } from 'vitest'
import { changedKeys, createEditor, stableJson } from '../src/settings/state'
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
    users: [], personal: [], catalog: { modules: [], defaultGroups: [] }, branding: { companyName: '', logoUrl: null },
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

    editor.resetSection('access')
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
