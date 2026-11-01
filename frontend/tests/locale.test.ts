import { describe, expect, it } from 'vitest'
import fixture from '../../tests/fixtures/locale-map.json'
import { effectiveLocale, normalizeLocale } from '../src/i18n/locale'

describe('locale map (shared with ModernUI_Locale_Model)', () => {
  it('normalizes Vtiger codes and locales as the fixture says', () => {
    for (const [code, expected] of Object.entries(fixture.map)) {
      expect(normalizeLocale(code), code).toBe(expected)
    }
    expect(normalizeLocale(undefined)).toBeNull()
    expect(normalizeLocale(42)).toBeNull()
  })

  it('chooses personal → CRM → common default → en-US', () => {
    for (const item of fixture.effective) {
      const result = effectiveLocale(item.personal, item.crm, item.default)
      expect([result.locale, result.source], JSON.stringify(item)).toEqual(item.expect)
    }
  })
})
