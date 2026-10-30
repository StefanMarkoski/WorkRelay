import { describe, expect, it } from 'vitest'
import { formatMajor, formatMoney, formatSpent, formatSyncPace, maxSyncCalls, minorToMajor } from './format'

describe('formatMoney', () => {
  it('treats the minor unit as the currency defines it', () => {
    expect(formatMoney(4999, 'EUR')).toContain('49.99')
    expect(formatMoney(5000, 'JPY')).toContain('5,000') // yen have no minor unit
    expect(formatMoney(12500, 'KWD')).toContain('12.500') // dinar have three decimals
  })
  it('handles missing values', () => {
    expect(formatMoney(null, 'EUR')).toBe('—')
    expect(formatMoney(1000, null)).toContain('no currency')
  })
})

describe('formatSpent', () => {
  it('shows each currency on its own and never adds them together', () => {
    const text = formatSpent({ JPY: 5000, EUR: 1000 })
    expect(text).toContain('10.00')
    expect(text).toContain('5,000')
    expect(text).toContain(' · ')
    expect(text.indexOf('10.00')).toBeLessThan(text.indexOf('5,000')) // EUR sorts before JPY
  })
  it('shows a dash when there is nothing to add up', () => {
    expect(formatSpent({})).toBe('—')
    expect(formatSpent(null)).toBe('—')
  })
})

describe('formatSyncPace', () => {
  it('turns calls per days into a pace in words', () => {
    expect(formatSyncPace(15, 1)).toBe('about every 1h 36m')
    expect(formatSyncPace(200, 7)).toBe('about every 50m')
    expect(formatSyncPace(24, 1)).toBe('about every 1h')
    expect(formatSyncPace(1, 7)).toBe('about every 7d')
    expect(formatSyncPace(2, 3)).toBe('about every 1d 12h')
  })
  it('says so when nothing is scheduled', () => {
    expect(formatSyncPace(null, null)).toBe('Not scheduled')
    expect(formatSyncPace(0, 1)).toBe('Not scheduled')
  })
  it('matches the fastest pace the database accepts (one call per 5 minutes)', () => {
    expect(maxSyncCalls(1)).toBe(288)
    expect(formatSyncPace(maxSyncCalls(1), 1)).toBe('about every 5m')
  })
})

describe('plotting money', () => {
  it('converts minor units to the currency\'s main unit', () => {
    expect(minorToMajor(4999, 'EUR')).toBeCloseTo(49.99)
    expect(minorToMajor(5000, 'JPY')).toBe(5000)
    expect(minorToMajor(12500, 'KWD')).toBeCloseTo(12.5)
  })
  it('formats a main-unit amount the way the rest of the app shows money', () => {
    expect(formatMajor(49.99, 'EUR')).toBe(formatMoney(4999, 'EUR'))
    expect(formatMajor(5000, 'JPY')).toBe(formatMoney(5000, 'JPY'))
  })
})
