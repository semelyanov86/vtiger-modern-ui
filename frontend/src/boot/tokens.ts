/**
 * Design tokens of the current user (docs/architecture.md §5.1, docs/design.md §3).
 *
 * The server is the source of the effective tokens: action=Tokens prints them as a render-blocking stylesheet
 * (no flash of the defaults on the first paint), action=Bootstrap sends the same map (ModernUI_Tokens_Model).
 * The shell sets that checked map on <html> as well, so the page is right even when the tokens stylesheet
 * failed to load. tokensFor() computes the same map in the browser for the live preview of the settings editor;
 * tests/fixtures/tokens.json keeps both implementations equal.
 */
import { TOKEN_NAMES, type AppearanceSettings, type Density, type FontChoice, type FontScale, type TokenMap } from '../api/types'
import { darken, mixWithWhite, strongVariant } from './color'

const DEFAULT_PRIMARY = '#3978fe'
/** The cloud reference for the default primary colour (docs/design.md §13.4): fill, hover, soft background, check box. */
const DEFAULT_PRIMARY_STRONG = '#3978fe'
const DEFAULT_PRIMARY_HOVER = '#315dff'
const DEFAULT_PRIMARY_SOFT = '#e7f1ff'
const DEFAULT_PRIMARY_CHECK = '#2e81ff'
const HOVER_DARKEN = 0.08
const SOFT_MIX = 0.12

const DEFAULTS: AppearanceSettings = {
  primaryColor: DEFAULT_PRIMARY,
  background: '#eff0f2',
  surface: '#ffffff',
  density: 'standard',
  fontScale: 100,
  font: 'cloud',
}

const DENSITY: Readonly<Record<Density, Pick<TokenMap, 'row-height' | 'table-head-height' | 'input-height' | 'button-height' | 'cell-padding' | 'menu-item-height' | 'icon-button'>>> = {
  compact: { 'row-height': '32px', 'table-head-height': '40px', 'input-height': '30px', 'button-height': '28px', 'cell-padding': '8px', 'menu-item-height': '30px', 'icon-button': '32px' },
  standard: { 'row-height': '40px', 'table-head-height': '50px', 'input-height': '36px', 'button-height': '34px', 'cell-padding': '12px', 'menu-item-height': '36px', 'icon-button': '36px' },
  comfortable: { 'row-height': '48px', 'table-head-height': '56px', 'input-height': '40px', 'button-height': '38px', 'cell-padding': '16px', 'menu-item-height': '40px', 'icon-button': '40px' },
}

const SCALE: Readonly<Record<FontScale, string>> = { 90: '0.9', 100: '1', 110: '1.1', 125: '1.25' }
const FONT: Readonly<Record<FontChoice, string>> = { cloud: 'var(--mu-font-cloud)', inter: 'var(--mu-font-inter)', system: 'var(--mu-font-system)' }

const HEX = /^#[0-9a-fA-F]{6}$/

function luminance(hex: string): number {
  const linear = (offset: number): number => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5)
}

/** A colour of the settings, or the default when it is not #rrggbb within the luminance limits of the schema. */
function color(value: unknown, fallback: string, limits: { min?: number; max?: number }): string {
  if (typeof value !== 'string' || !HEX.test(value)) {
    return fallback
  }
  const hex = value.toLowerCase()
  const lum = luminance(hex)
  if ((limits.max !== undefined && lum > limits.max) || (limits.min !== undefined && lum < limits.min)) {
    return fallback
  }
  return hex
}

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback
}

/** The token map of an appearance (same rules as ModernUI_Tokens_Model::forAppearance). */
export function tokensFor(appearance: Partial<Record<keyof AppearanceSettings, unknown>>): TokenMap {
  const primary = color(appearance.primaryColor, DEFAULTS.primaryColor, { max: 0.9 })
  const background = color(appearance.background, DEFAULTS.background, { min: 0.85 })
  const surface = color(appearance.surface, DEFAULTS.surface, { min: 0.92 })
  const density = oneOf<Density>(appearance.density, ['comfortable', 'standard', 'compact'], DEFAULTS.density)
  const scaleValue = typeof appearance.fontScale === 'string' ? Number(appearance.fontScale) : appearance.fontScale
  const fontScale = oneOf<FontScale>(scaleValue, [90, 100, 110, 125], DEFAULTS.fontScale)
  const font = oneOf<FontChoice>(appearance.font, ['cloud', 'inter', 'system'], DEFAULTS.font)
  const isDefault = primary === DEFAULT_PRIMARY
  const strong = isDefault ? DEFAULT_PRIMARY_STRONG : strongVariant(primary)
  return {
    primary,
    'primary-strong': strong,
    'primary-hover': isDefault ? DEFAULT_PRIMARY_HOVER : darken(strong, HOVER_DARKEN),
    'primary-soft': isDefault ? DEFAULT_PRIMARY_SOFT : mixWithWhite(primary, SOFT_MIX),
    'primary-check': isDefault ? DEFAULT_PRIMARY_CHECK : strong,
    bg: background,
    surface,
    'font-scale': SCALE[fontScale],
    'font-family': FONT[font],
    ...DENSITY[density],
  }
}

/** Sets the tokens on <html> (inline style beats both stylesheets). */
export function applyTokens(tokens: TokenMap): void {
  const style = document.documentElement.style
  for (const name of TOKEN_NAMES) {
    style.setProperty(`--mu-${name}`, tokens[name])
  }
}

/** Removes what applyTokens() set (standard view, failed start). */
export function clearTokens(): void {
  const style = document.documentElement.style
  for (const name of TOKEN_NAMES) {
    style.removeProperty(`--mu-${name}`)
  }
}
