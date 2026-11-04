/**
 * vue-i18n of the islands (docs/I18N.md, docs/dependencies.md §4): Composition API, messages precompiled by
 * @intlify/unplugin-vue-i18n (no message compiler at runtime), English fallback, Russian plural rule.
 * The en-US dictionary defines the schema; ru-RU and de-DE must have the same shape (type-checked here,
 * completeness and placeholders are checked by tests).
 */
import { createI18n } from 'vue-i18n'
import enUS from './locales/en-US.json'
import ruRU from './locales/ru-RU.json'
import deDE from './locales/de-DE.json'
import { FALLBACK_LOCALE, type ThemeLocale } from './locale'
import { russianPlural } from './plural'

export type MessageSchema = typeof enUS

declare module 'vue-i18n' {
  // Typed message keys for t() in every component.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefineLocaleMessage extends MessageSchema {}
}

export const messages: Record<ThemeLocale, MessageSchema> = {
  'en-US': enUS,
  'ru-RU': ruRU,
  'de-DE': deDE,
}

/** Additional dictionaries of a page (the editors): top-level keys of their own, merged per locale. */
export type ExtraMessages = Readonly<Record<ThemeLocale, Readonly<Record<string, unknown>>>>

export function createThemeI18n(locale: ThemeLocale, extra?: ExtraMessages) {
  const all = extra === undefined ? messages : {
    'en-US': { ...messages['en-US'], ...extra['en-US'] },
    'ru-RU': { ...messages['ru-RU'], ...extra['ru-RU'] },
    'de-DE': { ...messages['de-DE'], ...extra['de-DE'] },
  }
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: FALLBACK_LOCALE,
    messages: all,
    pluralRules: { 'ru-RU': russianPlural },
    missingWarn: import.meta.env.DEV,
    fallbackWarn: import.meta.env.DEV,
  })
}

export type ThemeI18n = ReturnType<typeof createThemeI18n>
