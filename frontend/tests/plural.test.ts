import { describe, expect, it } from 'vitest'
import { createThemeI18n } from '../src/i18n'
import { russianPlural } from '../src/i18n/plural'

describe('plural forms', () => {
  it('Russian: one / few / many, with an optional zero form', () => {
    const forms = (n: number, length: number) => russianPlural(n, length)
    expect([1, 21, 101].map((n) => forms(n, 3))).toEqual([0, 0, 0])
    expect([2, 3, 4, 22, 34].map((n) => forms(n, 3))).toEqual([1, 1, 1, 1, 1])
    expect([5, 11, 12, 14, 20, 25, 111].map((n) => forms(n, 3))).toEqual([2, 2, 2, 2, 2, 2, 2])
    expect([0, 1, 2, 5].map((n) => forms(n, 4))).toEqual([0, 1, 2, 3])
  })

  it('messages of the dictionaries use them', () => {
    const ru = createThemeI18n('ru-RU').global
    expect(ru.t('diagnostics.systemItems', 0)).toBe('В вашем меню нет пунктов')
    expect(ru.t('diagnostics.systemItems', 1)).toBe('В вашем меню 1 пункт')
    expect(ru.t('diagnostics.systemItems', 3)).toBe('В вашем меню 3 пункта')
    expect(ru.t('diagnostics.systemItems', 5)).toBe('В вашем меню 5 пунктов')
    expect(ru.t('diagnostics.systemItems', 21)).toBe('В вашем меню 21 пункт')
    const de = createThemeI18n('de-DE').global
    expect(de.t('diagnostics.systemItems', 1)).toBe('1 Eintrag in Ihrem Menü')
    expect(de.t('diagnostics.systemItems', 4)).toBe('4 Einträge in Ihrem Menü')
    const en = createThemeI18n('en-US').global
    expect(en.t('diagnostics.systemItems', 0)).toBe('No menu items')
    expect(en.t('diagnostics.systemItems', 2)).toBe('2 items in your menu')
  })

  it('falls back to English for a missing text', () => {
    const i18n = createThemeI18n('de-DE')
    i18n.global.mergeLocaleMessage('de-DE', { system: { title: '' } })
    expect(i18n.global.fallbackLocale.value).toBe('en-US')
    expect(i18n.global.t('system.preferences')).toBe('Einstellungen')
  })
})
