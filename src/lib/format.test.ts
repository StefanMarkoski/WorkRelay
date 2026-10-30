import { describe, expect, it } from 'vitest'
import { formatMoney, formatSpent } from './format'

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
