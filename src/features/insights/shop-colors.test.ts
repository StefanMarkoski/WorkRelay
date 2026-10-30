import { describe, expect, it } from 'vitest'
import { OTHER_COLOR, shopColor } from './shop-colors'

const shop = (id: string, created_at: string) => ({ id, created_at })
const shops = Array.from({ length: 8 }, (_, i) => shop(`s${i}`, `2026-10-0${i + 1}T00:00:00Z`))

describe('shopColor', () => {
  it('gives each shop a fixed colour by when it was connected, in the palette\'s order', () => {
    expect(shopColor('s0', shops)).toBe('var(--series-1)')
    expect(shopColor('s1', shops)).toBe('var(--series-2)')
    expect(shopColor('s5', shops)).toBe('var(--series-6)')
  })
  it('does not repaint a shop when others are filtered out or the list is reordered', () => {
    expect(shopColor('s1', [shops[1], shops[0]])).toBe(shopColor('s1', shops))
    expect(shopColor('s3', [...shops].reverse())).toBe(shopColor('s3', shops))
  })
  it('puts shops past the sixth, and unknown ones, on the neutral instead of inventing a hue', () => {
    expect(shopColor('s6', shops)).toBe(OTHER_COLOR)
    expect(shopColor('s7', shops)).toBe(OTHER_COLOR)
    expect(shopColor('nope', shops)).toBe(OTHER_COLOR)
  })
})
