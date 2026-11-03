/**
 * Runtime checks of server answers (docs/dependencies.md §5): no `as Bootstrap`, every field is verified.
 * A mismatch throws ApiError('MU_BAD_RESPONSE') with the path of the offending field; the island is not mounted.
 */
import { isThemeLocale, type LocaleSource } from '../i18n/locale'
import {
  ERROR_CODES,
  SYSTEM_ITEM_IDS,
  TOKEN_NAMES,
  type Appearance,
  type Bootstrap,
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

  constructor(code: ErrorCode, detail = '') {
    super(detail === '' ? code : `${code}: ${detail}`)
    this.name = 'ApiError'
    this.code = code
    this.detail = detail
  }
}

function bad(path: string): never {
  throw new ApiError('MU_BAD_RESPONSE', path)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, path: string): Record<string, unknown> {
  return isRecord(value) ? value : bad(path)
}

function string(value: unknown, path: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || (pattern !== undefined && !pattern.test(value))) {
    return bad(path)
  }
  return value
}

function boolean(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : bad(path)
}

function integer(value: unknown, path: string): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : bad(path)
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], path: string): T {
  const found = allowed.find((item) => item === value)
  return found ?? bad(path)
}

function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    return bad(path)
  }
  return value.map((item, index) => string(item, `${path}[${String(index)}]`))
}

const COLOR = /^#[0-9a-f]{6}$/
/** Links of the system menu: relative to index.php of the CRM, never another origin or a script URL. */
const CRM_URL = /^index\.php\?[A-Za-z0-9_=&%.:-]*$/
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

/** The "result" of a Bootstrap answer. */
export function parseBootstrap(value: unknown): Bootstrap {
  const data = record(value, 'result')
  if (data['v'] !== 1) {
    return bad('result.v')
  }
  const user = record(data['user'], 'user')
  const locale = record(data['locale'], 'locale')
  const theme = record(data['theme'], 'theme')
  const menu = record(data['menu'], 'menu')
  const personal = record(data['personal'], 'personal')
  const effective = locale['effective']
  if (!isThemeLocale(effective)) {
    return bad('locale.effective')
  }
  const system = menu['system']
  if (!Array.isArray(system)) {
    return bad('menu.system')
  }
  return {
    v: 1,
    build: string(data['build'], 'build', /^[0-9a-f]{0,40}$/),
    module: string(data['module'], 'module'),
    user: {
      isAdmin: boolean(user['isAdmin'], 'user.isAdmin'),
      crmLanguage: string(user['crmLanguage'], 'user.crmLanguage'),
    },
    locale: { effective, source: oneOf(locale['source'], LOCALE_SOURCES, 'locale.source') },
    theme: {
      active: boolean(theme['active'], 'theme.active'),
      reason: string(theme['reason'], 'theme.reason', /^[A-Z_]{1,40}$/),
      mode: oneOf(theme['mode'], THEME_MODES, 'theme.mode'),
      canOptOut: boolean(theme['canOptOut'], 'theme.canOptOut'),
      canSelfEnable: boolean(theme['canSelfEnable'], 'theme.canSelfEnable'),
      cacheKey: string(theme['cacheKey'], 'theme.cacheKey', /^[0-9a-f]{1,40}$/),
    },
    appearance: appearance(data['appearance'], 'appearance'),
    menu: { system: system.map((item, index) => systemItem(item, `menu.system[${String(index)}]`)) },
    personal: {
      values: record(personal['values'], 'personal.values'),
      allowed: stringList(personal['allowed'], 'personal.allowed'),
      revision: integer(personal['revision'], 'personal.revision'),
    },
  }
}

/** {revision} of a successful Preferences answer. */
export function parseRevision(value: unknown): number {
  return integer(record(value, 'result')['revision'], 'result.revision')
}

/** Error code of a failed answer ({success: false, error: {code}}); unknown codes become MU_UNKNOWN. */
export function errorCodeOf(value: unknown): ErrorCode {
  if (!isRecord(value) || !isRecord(value['error'])) {
    return 'MU_BAD_RESPONSE'
  }
  const code = value['error']['code']
  return ERROR_CODES.find((known) => known === code) ?? 'MU_UNKNOWN'
}
