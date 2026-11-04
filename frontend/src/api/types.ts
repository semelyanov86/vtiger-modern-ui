/**
 * Data the server sends to the islands (index.php?module=ModernUI&action=Bootstrap, docs/settings.md §7).
 * Network data is `unknown` until guards.ts has checked it.
 */
import type { LocaleSource, ThemeLocale } from '../i18n/locale'
import type { MenuIconName } from '../menu/icons'

export const SYSTEM_ITEM_IDS = ['preferences', 'standardView', 'safeMode', 'moduleSettings', 'crmSettings'] as const
export type SystemItemId = (typeof SYSTEM_ITEM_IDS)[number]

export type SystemItem =
  | { readonly id: SystemItemId; readonly kind: 'link'; readonly url: string }
  | { readonly id: SystemItemId; readonly kind: 'action'; readonly action: 'standardView' }

export type ThemeMode = 'off' | 'pilot' | 'all'
export type Density = 'comfortable' | 'standard' | 'compact'
export type FontScale = 90 | 100 | 110 | 125
export type FontChoice = 'inter' | 'system'

/** Settings values of the appearance (docs/settings.md §4). */
export interface AppearanceSettings {
  readonly primaryColor: string
  readonly background: string
  readonly surface: string
  readonly density: Density
  readonly fontScale: FontScale
  readonly font: FontChoice
}

/** CSS variables of the design tokens (without "--mu-"), computed by the server (ModernUI_Tokens_Model). */
export const TOKEN_NAMES = [
  'primary',
  'primary-strong',
  'primary-hover',
  'primary-soft',
  'bg',
  'surface',
  'font-scale',
  'font-family',
  'row-height',
  'table-head-height',
  'input-height',
  'button-height',
  'cell-padding',
  'menu-item-height',
  'icon-button',
] as const
export type TokenName = (typeof TOKEN_NAMES)[number]
export type TokenMap = Readonly<Record<TokenName, string>>

export interface Appearance extends AppearanceSettings {
  readonly tokens: TokenMap
}

/** Icon of a module like the v7 menu draws it, or an icon of the menu set chosen in the settings. */
export type ModuleIcon =
  | { readonly kind: 'vicon'; readonly name: string }
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'letters'; readonly text: string }
  | { readonly kind: 'lucide'; readonly name: MenuIconName }

export interface MenuItem {
  /** m:<module> or r:<route id> */
  readonly id: string
  readonly module: string
  readonly label: string
  readonly url: string
  readonly icon: ModuleIcon
}

export interface MenuGroup {
  readonly id: string
  readonly label: string
  readonly icon: MenuIconName
  readonly items: readonly MenuItem[]
}

/** The menu of the user built by the server from the modules the user may open (docs/settings.md §6.2). */
export interface Menu {
  readonly system: readonly SystemItem[]
  readonly groups: readonly MenuGroup[]
  readonly favorites: readonly MenuItem[]
  readonly favoritesEnabled: boolean
  readonly compact: boolean
}

/** null: as in the CRM (the v7 header keeps the company logo, no title of the theme). */
export interface Branding {
  readonly logoUrl: string | null
  readonly title: string | null
}

export interface Bootstrap {
  readonly v: 1
  readonly build: string
  readonly module: string
  readonly user: { readonly isAdmin: boolean; readonly crmLanguage: string }
  /** default: the common language of the theme for this user ("auto": the CRM language). */
  readonly locale: { readonly effective: ThemeLocale; readonly source: LocaleSource; readonly default: ThemeLocale | 'auto' }
  readonly theme: {
    readonly active: boolean
    readonly reason: string
    readonly mode: ThemeMode
    readonly canOptOut: boolean
    readonly canSelfEnable: boolean
    readonly cacheKey: string
  }
  readonly appearance: Appearance
  readonly branding: Branding
  readonly menu: Menu
  readonly personal: {
    readonly values: Readonly<Record<string, unknown>>
    readonly allowed: readonly string[]
    readonly revision: number
    /** Values without the personal ones ("as the administrator set it") for the allowed keys. */
    readonly inherited: Readonly<Record<string, unknown>>
  }
}

/** Error codes the islands translate (errors.* of the dictionaries). */
export const ERROR_CODES = [
  'MU_BAD_RESPONSE',
  'MU_NETWORK',
  'MU_SESSION_EXPIRED',
  'MU_FORBIDDEN_KEY',
  'MU_INVALID_VALUE',
  'MU_CONFLICT',
  'MU_BAD_REQUEST',
  'MU_MODULE_INACTIVE',
  'MU_SCHEMA_OUTDATED',
  'MU_SCHEMA_NEWER',
  'MU_UNKNOWN_KEY',
  'MU_UNKNOWN_ROLE',
  'MU_UNKNOWN_USER',
  'MU_LOGO_INVALID',
  'MU_LOGO_TOO_LARGE',
  'MU_LOGO_FORMAT',
  'MU_LOGO_DIMENSIONS',
  'MU_LOGO_UNSUPPORTED',
  'MU_LOGO_STORAGE',
  'MU_IMPORT_FORMAT',
  'MU_IMPORT_VERSION',
  'MU_IMPORT_TOO_LARGE',
  'MU_REJECTED',
  'MU_UNKNOWN',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
