/**
 * Dictionaries of the settings editor and the preferences editor (frontend/src/i18n/locales/editor/*.json). Kept apart
 * from the dictionaries of the shell, which every page of the CRM loads; the module's own pages add them with
 * createThemeI18n(locale, editorMessages). Same rules: same keys and placeholders in RU/EN/DE (tests), English fallback.
 */
import enUS from './locales/editor/en-US.json'
import ruRU from './locales/editor/ru-RU.json'
import deDE from './locales/editor/de-DE.json'
import type { ThemeLocale } from './locale'

export type EditorSchema = typeof enUS

declare module 'vue-i18n' {
  // Typed keys of the editor texts for t() in the components of the module's own pages.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface DefineLocaleMessage extends EditorSchema {}
}

export const editorMessages: Readonly<Record<ThemeLocale, EditorSchema>> = {
  'en-US': enUS,
  'ru-RU': ruRU,
  'de-DE': deDE,
}
