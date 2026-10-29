import { describe, expect, it } from 'vitest'
import { formatMoney } from './format'

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
