import { describe, expect, it } from 'vitest'
import labelFixture from '../../tests/fixtures/menu-labels.json'
import iconFixture from '../../tests/fixtures/menu-icons.json'
import { MENU_ICONS, ICON_COMPONENTS } from '../src/menu/icons'
import { cleanLabel, resolveLabel, type Labels } from '../src/menu/labels'
import { mentionedModules, parseGroups } from '../src/menu/config'
import { isThemeLocale } from '../src/i18n/locale'

describe('menu labels, icons and configuration', () => {
  it('resolve labels like the server (shared fixture)', () => {
    for (const [index, entry] of labelFixture.cases.entries()) {
      const locale = entry.locale
      if (!isThemeLocale(locale)) {
        throw new Error(`case ${String(index)}: locale`)
      }
      expect(resolveLabel(entry.labels as Labels | null, locale, entry.system), `case ${String(index)}`).toBe(entry.expected)
    }
  })

  it('offer the same icons as the server, each with a component', () => {
    expect([...MENU_ICONS]).toEqual(iconFixture.icons)
    for (const name of MENU_ICONS) {
      expect(ICON_COMPONENTS[name], name).toBeTruthy()
    }
  })

  it('clean labels like the server: control characters, length in characters, no markup or script URLs', () => {
    expect(cleanLabel('  Продажи\u0007 ')).toBe('Продажи')
    expect(cleanLabel('ß'.repeat(60))).toBe('ß'.repeat(60))
    expect(cleanLabel('ß'.repeat(61))).toBeNull()
    expect(cleanLabel('<b>x</b>')).toBeNull()
    expect(cleanLabel('JavaScript: alert(1)')).toBeNull()
  })

  it('read stored menus leniently and keep the exact shape', () => {
    const groups = parseGroups([
      { id: 'sales', source: { app: 'SALES' }, label: { 'de-DE': 'Vertrieb' }, icon: 'target', collapsed: false, items: [
        { type: 'module', module: 'Leads', label: null, icon: null },
        { type: 'route', id: 'calls', label: { 'en-US': 'Calls' }, icon: 'phone', route: { module: 'Calendar', view: 'List', params: { viewname: '12', url: 'x' } } },
        { type: 'module', module: '../etc' },
      ] },
      { id: 'BAD ID', items: [] },
    ])
    expect(groups).toEqual([{
      id: 'sales', source: { app: 'SALES' }, label: { 'de-DE': 'Vertrieb' }, icon: 'target', collapsed: false, items: [
        { type: 'module', module: 'Leads', label: null, icon: null },
        { type: 'route', id: 'calls', label: { 'en-US': 'Calls' }, icon: 'phone', route: { module: 'Calendar', view: 'List', params: { viewname: '12' } } },
      ],
    }])
    expect(parseGroups(null)).toBeNull()
    expect([...mentionedModules(groups ?? [])]).toEqual(['Leads'])
  })
})
