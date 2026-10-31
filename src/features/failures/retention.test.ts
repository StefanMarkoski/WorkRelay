import { describe, expect, it } from 'vitest'
import { MAX_RETENTION_DAYS, MIN_RETENTION_DAYS, parseRetentionDays } from './retention'

describe('parseRetentionDays', () => {
  it('accepts a whole number of days from 1 to 365', () => {
    expect(MIN_RETENTION_DAYS).toBe(1)
    expect(MAX_RETENTION_DAYS).toBe(365)
    expect(parseRetentionDays('1')).toBe(1)
    expect(parseRetentionDays('90')).toBe(90)
    expect(parseRetentionDays('365')).toBe(365)
    expect(parseRetentionDays(' 30 ')).toBe(30)
  })

  it('refuses everything else', () => {
    for (const text of ['', '0', '366', '1000', '-5', '1.5', '1e2', '30 days', 'abc', '０', '+7', '007x']) {
      expect(parseRetentionDays(text), text).toBeNull()
    }
  })
})
