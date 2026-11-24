import { describe, expect, it } from 'vitest'
import { availableWidth, visibleCount } from '../src/record/actions'

describe('visibleCount: header buttons of DETAILVIEWBASIC links that stay in the header', () => {
  it('keeps every button when all fit, counting the gap between them', () => {
    expect(visibleCount([85, 150, 135], 386)).toBe(3)
    expect(visibleCount([85, 150, 135], 385)).toBe(2)
  })

  it('folds from the end of the native order, never a button before a folded one', () => {
    expect(visibleCount([85, 150, 135, 155, 135], 462)).toBe(3)
    expect(visibleCount([300, 50], 200)).toBe(0)
  })

  it('natively hidden buttons cost nothing', () => {
    expect(visibleCount([85, 0, 150], 243)).toBe(3)
    expect(visibleCount([0, 0], 0)).toBe(2)
  })

  it('no buttons', () => {
    expect(visibleCount([], 100)).toBe(0)
  })
})

describe('availableWidth: the record name keeps its place before buttons', () => {
  it('reserves the name width, at most 240 px or 40 % of the row', () => {
    expect(availableWidth(1130, 300)).toBe(1130 - 12 - 240)
    expect(availableWidth(1130, 120)).toBe(1130 - 12 - 120)
    expect(availableWidth(230, 300)).toBe(230 - 12 - 92)
  })

  it('is never negative', () => {
    expect(availableWidth(5, 300)).toBe(0)
  })
})
