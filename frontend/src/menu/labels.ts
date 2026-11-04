/**
 * Custom labels of menu groups and items (docs/settings.md §6.2 item 8, docs/I18N.md): variants for ru-RU, en-US,
 * de-DE and "*" (any other language). The same resolution as ModernUI_Menu_Model::label(); both are checked against
 * tests/fixtures/menu-labels.json.
 */
import type { ThemeLocale } from '../i18n/locale'

export const LABEL_LOCALES = ['ru-RU', 'en-US', 'de-DE', '*'] as const
export type LabelLocale = (typeof LABEL_LOCALES)[number]
export type Labels = Partial<Record<LabelLocale, string>>

/** Same limits as the server: 1–60 characters of plain text. */
export const LABEL_MAX = 60

/** locale → "*" → system label → en-US → first variant; null when nothing is set. */
export function resolveLabel(labels: Labels | null | undefined, locale: ThemeLocale, system: string | null): string | null {
  const map = labels ?? {}
  for (const key of [locale, '*'] as const) {
    const text = map[key]
    if (text !== undefined && text !== '') {
      return text
    }
  }
  if (system !== null && system !== '') {
    return system
  }
  const english = map['en-US']
  if (english !== undefined && english !== '') {
    return english
  }
  for (const key of LABEL_LOCALES) {
    const text = map[key]
    if (text !== undefined && text !== '') {
      return text
    }
  }
  return null
}

/** The text of a label as the server stores it: control characters removed, spaces trimmed; null if not allowed. */
export function cleanLabel(text: string): string | null {
  const cleaned = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
  if (Array.from(cleaned).length > LABEL_MAX || /[<>]|(?:java|vb)script\s*:|data\s*:\s*text\/html/i.test(cleaned)) {
    return null
  }
  return cleaned
}

/** Labels without empty variants; null when none is left. */
export function compactLabels(labels: Labels): Labels | null {
  const result: Labels = {}
  for (const key of LABEL_LOCALES) {
    const text = labels[key]
    if (text !== undefined && text.trim() !== '') {
      result[key] = text.trim()
    }
  }
  return Object.keys(result).length > 0 ? result : null
}

export function isLabels(value: unknown): value is Labels {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.entries(value).every(([key, text]) => (LABEL_LOCALES as readonly string[]).includes(key) && typeof text === 'string')
}
