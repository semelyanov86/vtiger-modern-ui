/**
 * Design tokens of the current user (docs/architecture.md §5.1): CSS variables on <html>. The loader sets
 * the cached values synchronously before the first paint; the shell sets the confirmed ones from Bootstrap and
 * refreshes the cache (key: user + settings revisions, computed by the server).
 */
import type { Appearance, Density } from '../api/types'
import { darken, strongVariant } from './color'

const CACHE_PREFIX = 'modernui:tokens:'

const DENSITY: Readonly<Record<Density, Readonly<Record<string, string>>>> = {
  compact: { '--mu-row-height': '32px', '--mu-input-height': '30px', '--mu-button-height': '28px', '--mu-cell-padding': '8px', '--mu-menu-item-height': '30px', '--mu-icon-button': '32px' },
  standard: { '--mu-row-height': '40px', '--mu-input-height': '36px', '--mu-button-height': '34px', '--mu-cell-padding': '12px', '--mu-menu-item-height': '36px', '--mu-icon-button': '36px' },
  comfortable: { '--mu-row-height': '48px', '--mu-input-height': '40px', '--mu-button-height': '38px', '--mu-cell-padding': '16px', '--mu-menu-item-height': '40px', '--mu-icon-button': '40px' },
}

/** CSS variables for an appearance. */
export function tokensFor(appearance: Appearance): Record<string, string> {
  const strong = strongVariant(appearance.primaryColor)
  return {
    '--mu-primary': appearance.primaryColor,
    '--mu-primary-strong': strong,
    '--mu-primary-hover': darken(strong, 0.08),
    '--mu-bg': appearance.background,
    '--mu-surface': appearance.surface,
    '--mu-font-scale': String(appearance.fontScale / 100),
    '--mu-font-family': appearance.font === 'system' ? 'var(--mu-font-system)' : 'var(--mu-font-inter)',
    ...DENSITY[appearance.density],
  }
}

export function applyTokens(tokens: Readonly<Record<string, string>>): void {
  const style = document.documentElement.style
  for (const [name, value] of Object.entries(tokens)) {
    style.setProperty(name, value)
  }
}

export function clearTokens(tokens: Readonly<Record<string, string>>): void {
  const style = document.documentElement.style
  for (const name of Object.keys(tokens)) {
    style.removeProperty(name)
  }
}

/** Stores the tokens for the next page of the same user and settings revision; drops older entries. */
export function cacheTokens(cacheKey: string, tokens: Readonly<Record<string, string>>): void {
  try {
    const storage = window.localStorage
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index)
      if (key !== null && key.startsWith(CACHE_PREFIX) && key !== CACHE_PREFIX + cacheKey) {
        storage.removeItem(key)
      }
    }
    storage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(tokens))
  } catch {
    // Storage blocked or full: the next page starts with the default tokens of the skin.
  }
}
