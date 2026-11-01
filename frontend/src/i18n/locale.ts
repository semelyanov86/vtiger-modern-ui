/**
 * Locales of the theme (docs/I18N.md). The same table exists in PHP (ModernUI_Locale_Model); both are checked
 * against tests/fixtures/locale-map.json.
 */
export const THEME_LOCALES = ['ru-RU', 'en-US', 'de-DE'] as const
export type ThemeLocale = (typeof THEME_LOCALES)[number]
export const FALLBACK_LOCALE: ThemeLocale = 'en-US'

export type LocaleSource = 'personal' | 'crm' | 'global' | 'fallback'

const ALIASES: ReadonlyMap<string, ThemeLocale> = new Map<string, ThemeLocale>([
  ['ru_ru', 'ru-RU'],
  ['ru', 'ru-RU'],
  ['en_us', 'en-US'],
  ['en_gb', 'en-US'],
  ['en', 'en-US'],
  ['de_de', 'de-DE'],
  ['de', 'de-DE'],
])

export function isThemeLocale(value: unknown): value is ThemeLocale {
  return typeof value === 'string' && (THEME_LOCALES as readonly string[]).includes(value)
}

/** A Vtiger language code or locale (ru_ru, ru, ru_RU, ru-RU …) as a theme locale, or null if unknown. */
export function normalizeLocale(code: unknown): ThemeLocale | null {
  if (typeof code !== 'string' || code === '') {
    return null
  }
  return ALIASES.get(code.trim().toLowerCase().replace(/-/g, '_')) ?? null
}

/** Personal choice → CRM language → common default → en-US (same order as the server). */
export function effectiveLocale(
  personal: unknown,
  crmLanguage: unknown,
  commonDefault: unknown,
): { locale: ThemeLocale; source: LocaleSource } {
  if (isThemeLocale(personal)) {
    return { locale: personal, source: 'personal' }
  }
  const crm = normalizeLocale(crmLanguage)
  if (crm !== null) {
    return { locale: crm, source: 'crm' }
  }
  if (isThemeLocale(commonDefault)) {
    return { locale: commonDefault, source: 'global' }
  }
  return { locale: FALLBACK_LOCALE, source: 'fallback' }
}
