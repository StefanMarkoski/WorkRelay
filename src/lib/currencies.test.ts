import { describe, expect, it } from 'vitest'
import { COMMON_CURRENCIES, currencyLabel, isCurrencyCode, otherCurrencies } from './currencies'

describe('currencies', () => {
  it('accepts exactly what the database accepts: three upper-case letters', () => {
    for (const ok of ['MKD', 'USD', 'EUR']) expect(isCurrencyCode(ok)).toBe(true)
    for (const bad of ['', 'mk', 'mkd', 'MKDD', 'M1D', ' MKD', 'US$']) expect(isCurrencyCode(bad)).toBe(false)
  })
  it('puts the denar and the dollar in the short list, and every short-list entry is a valid code', () => {
    expect(COMMON_CURRENCIES).toContain('MKD')
    expect(COMMON_CURRENCIES).toContain('USD')
    for (const c of COMMON_CURRENCIES) expect(isCurrencyCode(c)).toBe(true)
  })
  it('does not list a currency twice: the longer list leaves out the short one', () => {
    const rest = otherCurrencies()
    for (const c of COMMON_CURRENCIES) expect(rest).not.toContain(c)
    expect(new Set(rest).size).toBe(rest.length)
    expect(rest).toEqual([...rest].sort())
    for (const c of rest) expect(isCurrencyCode(c)).toBe(true)
  })
  it('names a currency, and falls back to the code', () => {
    expect(currencyLabel('MKD')).toMatch(/^MKD/)
    expect(currencyLabel('USD')).toContain('USD')
    expect(currencyLabel('ZZZ').startsWith('ZZZ')).toBe(true)
  })
})
