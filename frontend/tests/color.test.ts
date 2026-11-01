import { describe, expect, it } from 'vitest'
import { contrast, luminance, strongVariant } from '../src/boot/color'
import { tokensFor } from '../src/boot/tokens'

describe('colour tokens', () => {
  it('luminance matches the PHP validation (WCAG relative luminance)', () => {
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
    expect(luminance('#3978fe')).toBeCloseTo(0.215, 2)
  })

  it('the strong variant keeps white text readable (≥ 4.5:1) and leaves dark colours alone', () => {
    for (const colour of ['#3978fe', '#26c6da', '#fe8d49', '#97adc3', '#5ed092']) {
      const strong = strongVariant(colour)
      expect(contrast(strong, '#ffffff'), colour).toBeGreaterThanOrEqual(4.5)
      expect(luminance(strong), colour).toBeLessThanOrEqual(luminance(colour))
    }
    expect(strongVariant('#1c2121')).toBe('#1c2121')
  })

  it('tokens cover colours, scale, font and density', () => {
    const tokens = tokensFor({ primaryColor: '#3978fe', background: '#eff0f2', surface: '#ffffff', density: 'compact', fontScale: 110, font: 'system' })
    expect(tokens['--mu-font-scale']).toBe('1.1')
    expect(tokens['--mu-font-family']).toBe('var(--mu-font-system)')
    expect(tokens['--mu-row-height']).toBe('32px')
    // The loader accepts only these characters when it restores cached tokens.
    for (const [name, value] of Object.entries(tokens)) {
      expect(name).toMatch(/^--mu-[a-z0-9-]+$/)
      expect(value).toMatch(/^[#a-zA-Z0-9.,%() -]{1,64}$/)
    }
  })
})
