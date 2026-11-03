/**
 * Colour helpers for the tokens (docs/design.md §3.1): WCAG contrast and a darker variant of the primary
 * colour that keeps white text readable (≥ 4.5:1) on buttons.
 */

function channel(hex: string, offset: number): number {
  return Number.parseInt(hex.slice(offset, offset + 2), 16)
}

function linear(value: number): number {
  const c = value / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of #rrggbb (0 … 1), as ModernUI_Settings_Model::luminance() in PHP. */
export function luminance(hex: string): number {
  return 0.2126 * linear(channel(hex, 1)) + 0.7152 * linear(channel(hex, 3)) + 0.0722 * linear(channel(hex, 5))
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

/** Darkens a colour by a factor (0 … 1) towards black. */
export function darken(hex: string, amount: number): string {
  const keep = 1 - amount
  return toHex(channel(hex, 1) * keep, channel(hex, 3) * keep, channel(hex, 5) * keep)
}

/** Mixes a colour with white: `weight` is the share of the colour (0 … 1). */
export function mixWithWhite(hex: string, weight: number): string {
  const mix = (offset: number): number => channel(hex, offset) * weight + 255 * (1 - weight)
  return toHex(mix(1), mix(3), mix(5))
}

/** The colour itself if white text on it reaches `ratio`, otherwise the nearest darker variant that does. */
export function strongVariant(hex: string, ratio = 4.5): string {
  let candidate = hex
  for (let step = 0; step < 40 && contrast(candidate, '#ffffff') < ratio; step++) {
    candidate = darken(hex, (step + 1) * 0.025)
  }
  return candidate
}
