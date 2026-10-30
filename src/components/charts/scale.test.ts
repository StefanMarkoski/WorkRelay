import { describe, expect, it } from 'vitest'
import { foldSlices, formatCompact, formatDelta, niceTicks, percentOf } from './scale'

describe('niceTicks', () => {
  it('rounds the top to a clean number and starts at zero', () => {
    expect(niceTicks(17)).toEqual([0, 5, 10, 15, 20])
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100])
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10])
    expect(niceTicks(1234, 4)).toEqual([0, 500, 1000, 1500])
    expect(niceTicks(1234, 4).at(-1)).toBeGreaterThanOrEqual(1234 - 1) // covers the data within one step
  })
  it('always covers the maximum', () => {
    for (const max of [0.3, 1, 3, 7, 18, 99, 101, 5400, 123456]) expect(niceTicks(max).at(-1)!).toBeGreaterThanOrEqual(max)
  })
  it('has a sane answer for nothing to plot', () => {
    for (const bad of [0, -3, NaN, Infinity]) expect(niceTicks(bad)).toEqual([0, 1])
  })
  it('has no floating-point noise', () => {
    for (const t of niceTicks(0.7)) expect(String(t).length).toBeLessThan(8)
  })
})

describe('formatting', () => {
  it('compacts big numbers for axes', () => {
    expect(formatCompact(950)).toBe('950')
    expect(formatCompact(12_400)).toBe('12.4K')
    expect(formatCompact(3_200_000)).toBe('3.2M')
  })
  it('gives a share, never 0% for something that exists', () => {
    expect(percentOf(1, 3)).toBe('33%')
    expect(percentOf(1, 1000)).toBe('<1%')
    expect(percentOf(0, 10)).toBe('0%')
    expect(percentOf(5, 0)).toBe('0%')
  })
  it('compares with the previous period, and says nothing when there was none', () => {
    expect(formatDelta(150, 100)).toBe('+50%')
    expect(formatDelta(50, 100)).toBe('-50%')
    expect(formatDelta(100, 100)).toBe('no change')
    expect(formatDelta(5, 0)).toBeNull()
  })
})

describe('foldSlices', () => {
  const mk = (v: number, k = String(v)) => ({ key: k, value: v })
  const other = (rest: { value: number }[]) => ({ key: 'other', value: rest.reduce((n, r) => n + r.value, 0) })
  it('keeps everything when it fits, largest first', () => {
    expect(foldSlices([mk(1), mk(5), mk(3)], 6, other).map((s) => s.value)).toEqual([5, 3, 1])
  })
  it('folds the tail into one "Other" so the total is preserved', () => {
    const out = foldSlices([mk(10), mk(9), mk(8), mk(7), mk(1), mk(1), mk(1)], 5, other)
    expect(out).toHaveLength(5)
    expect(out.at(-1)).toEqual({ key: 'other', value: 3 })
    expect(out.reduce((n, s) => n + s.value, 0)).toBe(37)
  })
})
