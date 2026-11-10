/**
 * Names of the settings keys for people (conflicts, import reports, errors with a path) and short forms of values.
 */
import type { Composer } from 'vue-i18n'

type Translate = Composer['t']

/** Known keys of the schema (docs/settings.md §4); other keys are shown as they are. */
export const FIELD_KEYS = [
  'theme.mode', 'theme.pilot.users', 'theme.pilot.roles', 'theme.pilot.includeSubordinates', 'theme.allowSelfEnable',
  'theme.allowOptOut', 'theme.excludedScreens', 'policy.userOverrides', 'locale.default', 'locale',
  'appearance.primaryColor', 'appearance.background', 'appearance.surface', 'appearance.density', 'appearance.fontScale',
  'appearance.font', 'branding.logo', 'branding.title', 'branding.noticeEnabled', 'branding.notice', 'navigation.groups', 'navigation.hidden',
  'navigation.favoritesEnabled', 'navigation.compact', 'navigation.favorites', 'user.standardView', 'user.selfEnabled',
] as const

/** "navigation.groups[2].items[0].label.de-DE" → key "navigation.groups" and the rest of the path. */
export function splitPath(path: string): { key: string; rest: string } {
  const key = FIELD_KEYS.find((known) => path === known || path.startsWith(`${known}[`) || path.startsWith(`${known}.`))
  return key === undefined ? { key: path, rest: '' } : { key, rest: path.slice(key.length) }
}

export function fieldLabel(t: Translate): (key: string) => string {
  return (key: string): string => {
    const known = FIELD_KEYS.find((entry) => entry === key)
    return known === undefined ? key : t(`fields.${known.replace(/\./g, '_')}`)
  }
}

/** A path of an error as text: the name of the field and the place inside it. */
export function pathLabel(t: Translate, path: string): string {
  const { key, rest } = splitPath(path)
  return rest === '' ? fieldLabel(t)(key) : `${fieldLabel(t)(key)} ${rest}`
}

/**
 * A value of a known key for people, for the line under a field that tells where its value comes from ("inherited from
 * the common settings: Compact", "default: #3978fe").
 */
export function describeValue(t: Translate, key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return t('editor.values.unset')
  }
  switch (key) {
    case 'appearance.density':
      return typeof value === 'string' ? t(`editor.appearance.density.${value}`) : valueText(t, value)
    case 'appearance.fontScale':
      return typeof value === 'number' ? `${String(value)} %` : valueText(t, value)
    case 'appearance.font':
      return typeof value === 'string' ? t(`editor.appearance.fontShort.${value}`) : valueText(t, value)
    case 'locale.default':
      return value === 'auto' ? t('editor.language.auto') : typeof value === 'string' ? t(`languages.${value}`) : valueText(t, value)
    case 'branding.logo':
      return value === 'company' ? t('editor.appearance.logoCompanyShort') : t('editor.appearance.logoCustomShort')
    case 'branding.title':
      return value === 'company' ? t('editor.appearance.titleCompanyShort') : t('editor.appearance.titleCustomShort')
    case 'navigation.groups':
      return Array.isArray(value) ? t('editor.values.groups', value.length) : t('editor.menu.crmMenuShort')
    case 'navigation.hidden':
    case 'theme.excludedScreens':
    case 'adapters.disabled':
      return Array.isArray(value) ? (value.length === 0 ? t('editor.values.empty') : t('editor.values.count', value.length)) : valueText(t, value)
    default:
      return valueText(t, value)
  }
}

/** Short text of a value of an import report or a conflict. */
export function valueText(t: Translate, value: unknown): string {
  if (value === null || value === undefined) {
    return t('editor.values.unset')
  }
  if (typeof value === 'boolean') {
    return value ? t('editor.values.yes') : t('editor.values.no')
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? t('editor.values.empty') : value.map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry) : '…')).join(', ')
  }
  if (typeof value === 'object') {
    const entry = value as Record<string, unknown>
    if (typeof entry['groups'] === 'number' && typeof entry['items'] === 'number') {
      return t('editor.values.menu', { groups: entry['groups'], items: entry['items'] })
    }
    if (typeof entry['count'] === 'number') {
      return t('editor.values.count', entry['count'])
    }
    return Object.entries(entry).map(([key, text]) => `${key}: ${typeof text === 'string' ? text : '…'}`).join('; ')
  }
  return '…'
}
