import { describe, expect, it } from 'vitest'
import fixture from '../../tests/fixtures/tokens.json'
import { parseTokens } from '../src/api/guards'
import { contrast, luminance, mixWithWhite, strongVariant } from '../src/boot/color'
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

  it('mixes with white towards the soft background of the primary colour', () => {
    expect(mixWithWhite('#000000', 0)).toBe('#ffffff')
    expect(mixWithWhite('#000000', 1)).toBe('#000000')
    expect(mixWithWhite('#2e9a5e', 0.12)).toBe('#e6f3ec')
  })
})

describe('design tokens (shared with ModernUI_Tokens_Model)', () => {
  it('compute the same map as the server for every case of the fixture', () => {
    for (const item of fixture.cases) {
      expect(tokensFor(item.appearance), item.name).toEqual(item.tokens)
    }
  })

  it('the server map passes the runtime check of a Bootstrap answer, a foreign value does not', () => {
    for (const item of fixture.cases) {
      expect(parseTokens(item.tokens, 'tokens'), item.name).toEqual(item.tokens)
      expect(contrast(item.tokens['primary-strong'], '#ffffff'), item.name).toBeGreaterThanOrEqual(4.5)
    }
    const base = { ...tokensFor({}) }
    expect(() => parseTokens({ ...base, primary: '#000;}body{' }, 'tokens')).toThrow(/tokens\.primary/)
    expect(() => parseTokens({ ...base, 'font-family': 'url(x)' }, 'tokens')).toThrow(/font-family/)
    expect(() => parseTokens({ ...base, extra: '1px' }, 'tokens')).toThrow(/tokens\.extra/)
    const missing: Record<string, string> = { ...base }
    delete missing['row-height']
    expect(() => parseTokens(missing, 'tokens')).toThrow(/row-height/)
  })
})
