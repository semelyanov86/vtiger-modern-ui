/**
 * Runtime checks of server answers (docs/dependencies.md §5): no `as Bootstrap`, every field is verified.
 * A mismatch throws ApiError('MU_BAD_RESPONSE') with the path of the offending field; the island is not mounted.
 */
import { isThemeLocale, type LocaleSource } from '../i18n/locale'
import { isMenuIcon } from '../menu/icons'
import {
  ERROR_CODES,
  SYSTEM_ITEM_IDS,
  TOKEN_NAMES,
  type ActiveAdapter,
  type Appearance,
  type Bootstrap,
  type Branding,
  type Menu,
  type MenuGroup,
  type MenuItem,
  type ModuleIcon,
  type Density,
  type ErrorCode,
  type FontChoice,
  type FontScale,
  type SystemItem,
  type SystemItemId,
  type ThemeMode,
  type TokenMap,
  type TokenName,
} from './types'

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly detail: string
  /** {error: {params}} of the server answer: paths of invalid values, the current revision of a conflict… */
  readonly params: Readonly<Record<string, unknown>>

  constructor(code: ErrorCode, detail = '', params: Readonly<Record<string, unknown>> = {}) {
    super(detail === '' ? code : `${code}: ${detail}`)
    this.name = 'ApiError'
    this.code = code
    this.detail = detail
    this.params = params
  }
}

export function bad(path: string): never {
  throw new ApiError('MU_BAD_RESPONSE', path)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : bad(path)
}

export function string(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || (pattern !== undefined && !pattern.test(value))) {
    return bad(path)
  }
  return value
}

export function boolean(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : bad(path)
}

export function integer(value: unknown, path: string): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : bad(path)
}

export function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], path: string): T {
  const found = allowed.find((item) => item === value)
  return found ?? bad(path)
}

export function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    return bad(path)
  }
  return value.map((item, index) => string(item, `${path}[${String(index)}]`))
}

export const COLOR = /^#[0-9a-f]{6}$/
/** Links of the menus: relative to index.php of the CRM, never another origin or a script URL. */
export const CRM_URL = /^index\.php\?[A-Za-z0-9_=&%.:-]*$/
/** Logo of the theme: served by public.php of the CRM like the company logo, name chosen by the server. */
export const LOGO_URL = /^public\.php\?type=logo&key=modernui_[0-9a-f]{40}\.png$/
/** Icon image of a module (layouts/v7/modules/<Module>/<Module>.png), never outside the layouts. */
const ICON_IMAGE = /^layouts\/[A-Za-z0-9_-]+\/modules\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+\.png$/
const MODULE = /^[A-Za-z0-9_]{1,50}$/
const LOCALE_SOURCES: readonly LocaleSource[] = ['personal', 'crm', 'global', 'fallback']
const THEME_MODES: readonly ThemeMode[] = ['off', 'pilot', 'all']
const DENSITIES: readonly Density[] = ['comfortable', 'standard', 'compact']
const FONT_SCALES: readonly FontScale[] = [90, 100, 110, 125]
const FONTS: readonly FontChoice[] = ['inter', 'system']

function systemItem(value: unknown, path: string): SystemItem {
  const item = record(value, path)
  const id: SystemItemId = oneOf(item['id'], SYSTEM_ITEM_IDS, `${path}.id`)
  if (item['action'] !== undefined) {
    return { id, kind: 'action', action: oneOf(item['action'], ['standardView'] as const, `${path}.action`) }
  }
  return { id, kind: 'link', url: string(item['url'], `${path}.url`, CRM_URL) }
}

/** Allowed value of each token: nothing else can reach the style of <html>. */
const TOKEN_VALUE: Readonly<Record<TokenName, RegExp>> = {
  primary: COLOR,
  'primary-strong': COLOR,
  'primary-hover': COLOR,
  'primary-soft': COLOR,
  bg: COLOR,
  surface: COLOR,
  'font-scale': /^(?:0\.9|1|1\.1|1\.25)$/,
  'font-family': /^var\(--mu-font-(?:inter|system)\)$/,
  'row-height': /^\d{2}px$/,
  'table-head-height': /^\d{2}px$/,
  'input-height': /^\d{2}px$/,
  'button-height': /^\d{2}px$/,
  'cell-padding': /^\d{1,2}px$/,
  'menu-item-height': /^\d{2}px$/,
  'icon-button': /^\d{2}px$/,
}

export function parseTokens(value: unknown, path: string): TokenMap {
  const data = record(value, path)
  for (const name of Object.keys(data)) {
    if (!TOKEN_NAMES.some((known) => known === name)) {
      return bad(`${path}.${name}`)
    }
  }
  const token = (name: TokenName): string => string(data[name], `${path}.${name}`, TOKEN_VALUE[name])
  return {
    primary: token('primary'),
    'primary-strong': token('primary-strong'),
    'primary-hover': token('primary-hover'),
    'primary-soft': token('primary-soft'),
    bg: token('bg'),
    surface: token('surface'),
    'font-scale': token('font-scale'),
    'font-family': token('font-family'),
    'row-height': token('row-height'),
    'table-head-height': token('table-head-height'),
    'input-height': token('input-height'),
    'button-height': token('button-height'),
    'cell-padding': token('cell-padding'),
    'menu-item-height': token('menu-item-height'),
    'icon-button': token('icon-button'),
  }
}

function appearance(value: unknown, path: string): Appearance {
  const data = record(value, path)
  return {
    primaryColor: string(data['primaryColor'], `${path}.primaryColor`, COLOR),
    background: string(data['background'], `${path}.background`, COLOR),
    surface: string(data['surface'], `${path}.surface`, COLOR),
    density: oneOf(data['density'], DENSITIES, `${path}.density`),
    fontScale: oneOf(data['fontScale'], FONT_SCALES, `${path}.fontScale`),
    font: oneOf(data['font'], FONTS, `${path}.font`),
    tokens: parseTokens(data['tokens'], `${path}.tokens`),
  }
}

export function moduleIcon(value: unknown, path: string): ModuleIcon {
  const icon = record(value, path)
  switch (icon['kind']) {
    case 'vicon':
      return { kind: 'vicon', name: string(icon['name'], `${path}.name`, /^vicon-[a-z0-9_]{1,60}$/) }
    case 'image':
      return { kind: 'image', src: string(icon['src'], `${path}.src`, ICON_IMAGE) }
    case 'letters':
      return { kind: 'letters', text: string(icon['text'], `${path}.text`, /^.{0,4}$/u) }
    case 'lucide': {
      const name = icon['name']
      return isMenuIcon(name) ? { kind: 'lucide', name } : bad(`${path}.name`)
    }
    default:
      return bad(`${path}.kind`)
  }
}

function menuItem(value: unknown, path: string): MenuItem {
  const item = record(value, path)
  return {
    id: string(item['id'], `${path}.id`, /^[mr]:[A-Za-z0-9_-]{1,50}$/),
    module: string(item['module'], `${path}.module`, MODULE),
    label: string(item['label'], `${path}.label`, /^[^<>]{1,200}$/u),
    url: string(item['url'], `${path}.url`, CRM_URL),
    icon: moduleIcon(item['icon'], `${path}.icon`),
  }
}

function menuItems(value: unknown, path: string): MenuItem[] {
  return Array.isArray(value) ? value.map((item, index) => menuItem(item, `${path}[${String(index)}]`)) : bad(path)
}

function menuGroup(value: unknown, path: string): MenuGroup {
  const group = record(value, path)
  const icon = group['icon']
  const app = group['app']
  return {
    id: string(group['id'], `${path}.id`, /^[a-z0-9_-]{1,32}$/),
    label: string(group['label'], `${path}.label`, /^[^<>]{1,200}$/u),
    icon: isMenuIcon(icon) ? icon : bad(`${path}.icon`),
    app: app === undefined || app === null ? null : string(app, `${path}.app`, /^[A-Z0-9_]{1,40}$/),
    items: menuItems(group['items'], `${path}.items`),
  }
}

/** The menu of a Bootstrap answer (also the menu preview of the settings editor). */
export function parseBootstrapMenu(value: unknown): Menu {
  const data = record(value, 'menu')
  const system = data['system']
  const groups = data['groups']
  if (!Array.isArray(system)) {
    return bad('menu.system')
  }
  if (!Array.isArray(groups)) {
    return bad('menu.groups')
  }
  return {
    system: system.map((item, index) => systemItem(item, `menu.system[${String(index)}]`)),
    groups: groups.map((group, index) => menuGroup(group, `menu.groups[${String(index)}]`)),
    favorites: menuItems(data['favorites'], 'menu.favorites'),
    favoritesEnabled: boolean(data['favoritesEnabled'], 'menu.favoritesEnabled'),
    compact: boolean(data['compact'], 'menu.compact'),
    // The preview of the settings editor has no module list.
    modules: data['modules'] === undefined ? [] : stringList(data['modules'], 'menu.modules').map((name, index) => string(name, `menu.modules[${String(index)}]`, MODULE)),
    entries: data['entries'] === undefined ? [] : stringList(data['entries'], 'menu.entries').map((url, index) => string(url, `menu.entries[${String(index)}]`, CRM_URL)),
  }
}

function branding(value: unknown): Branding {
  const data = record(value, 'branding')
  const logoUrl = data['logoUrl']
  const title = data['title']
  return {
    logoUrl: logoUrl === null ? null : string(logoUrl, 'branding.logoUrl', LOGO_URL),
    title: title === null ? null : string(title, 'branding.title', /^[^<>]{1,200}$/u),
  }
}

/** Adapters of the active extensions (absent in answers of older modules: none). */
function adapters(value: unknown): readonly ActiveAdapter[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    return bad('adapters')
  }
  const part = /^(\*|[A-Za-z0-9_]{0,50})$/
  return value.map((entry, index) => {
    const path = `adapters[${String(index)}]`
    const item = record(entry, path)
    const screens = item['screens']
    if (!Array.isArray(screens)) {
      return bad(`${path}.screens`)
    }
    return {
      id: string(item['id'], `${path}.id`, /^[a-z0-9][a-z0-9-]{0,39}$/),
      module: string(item['module'], `${path}.module`, MODULE),
      version: string(item['version'], `${path}.version`, /^[0-9A-Za-z._-]{0,20}$/),
      script: boolean(item['script'], `${path}.script`),
      screens: screens.map((screen, position) => {
        const screenPath = `${path}.screens[${String(position)}]`
        const rule = record(screen, screenPath)
        return {
          module: string(rule['module'], `${screenPath}.module`, part),
          view: string(rule['view'], `${screenPath}.view`, part),
          parent: string(rule['parent'], `${screenPath}.parent`, part),
          level: oneOf(rule['level'], ['skin', 'standard'] as const, `${screenPath}.level`),
        }
      }),
    }
  })
}

/** Screens with the cloud layout (absent in answers of older modules: none). */
function layout(value: unknown): { readonly modules: readonly string[] } {
  if (value === undefined) {
    return { modules: [] }
  }
  const data = record(value, 'layout')
  return { modules: stringList(data['modules'], 'layout.modules').map((name, index) => string(name, `layout.modules[${String(index)}]`, MODULE)) }
}

/** The "result" of a Bootstrap answer. */
export function parseBootstrap(value: unknown): Bootstrap {
  const data = record(value, 'result')
  if (data['v'] !== 1) {
    return bad('result.v')
  }
  const user = record(data['user'], 'user')
  const locale = record(data['locale'], 'locale')
  const theme = record(data['theme'], 'theme')
  const personal = record(data['personal'], 'personal')
  const effective = locale['effective']
  if (!isThemeLocale(effective)) {
    return bad('locale.effective')
  }
  return {
    v: 1,
    build: string(data['build'], 'build', /^[0-9a-f]{0,40}$/),
    module: string(data['module'], 'module'),
    user: {
      isAdmin: boolean(user['isAdmin'], 'user.isAdmin'),
      crmLanguage: string(user['crmLanguage'], 'user.crmLanguage'),
    },
    locale: {
      effective,
      source: oneOf(locale['source'], LOCALE_SOURCES, 'locale.source'),
      default: oneOf(locale['default'], ['auto', 'ru-RU', 'en-US', 'de-DE'] as const, 'locale.default'),
    },
    theme: {
      active: boolean(theme['active'], 'theme.active'),
      reason: string(theme['reason'], 'theme.reason', /^[A-Z_]{1,40}$/),
      mode: oneOf(theme['mode'], THEME_MODES, 'theme.mode'),
      canOptOut: boolean(theme['canOptOut'], 'theme.canOptOut'),
      canSelfEnable: boolean(theme['canSelfEnable'], 'theme.canSelfEnable'),
      cacheKey: string(theme['cacheKey'], 'theme.cacheKey', /^[0-9a-f]{1,40}$/),
    },
    appearance: appearance(data['appearance'], 'appearance'),
    branding: branding(data['branding']),
    menu: parseBootstrapMenu(data['menu']),
    adapters: adapters(data['adapters']),
    layout: layout(data['layout']),
    personal: {
      values: record(personal['values'], 'personal.values'),
      allowed: stringList(personal['allowed'], 'personal.allowed'),
      revision: integer(personal['revision'], 'personal.revision'),
      inherited: record(personal['inherited'], 'personal.inherited'),
    },
  }
}

/** {revision} of a successful Preferences answer. */
export function parseRevision(value: unknown): number {
  return integer(record(value, 'result')['revision'], 'result.revision')
}

/**
 * Error code of a failed answer ({success: false, error: {code}}). A refusal of the core (permission, CSRF, Referer:
 * Vtiger answers {code: "<message>"} without a MU_ code) is MU_REJECTED; other unknown codes are MU_UNKNOWN.
 */
export function errorCodeOf(value: unknown): ErrorCode {
  if (!isRecord(value) || !isRecord(value['error'])) {
    return 'MU_BAD_RESPONSE'
  }
  const code = value['error']['code']
  const known = ERROR_CODES.find((entry) => entry === code)
  if (known !== undefined) {
    return known
  }
  return typeof code === 'string' && !code.startsWith('MU_') ? 'MU_REJECTED' : 'MU_UNKNOWN'
}

/** Parameters of a failed answer ({error: {params}}), unchecked. */
export function errorParamsOf(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value['error']) || !isRecord(value['error']['params'])) {
    return {}
  }
  return value['error']['params']
}
