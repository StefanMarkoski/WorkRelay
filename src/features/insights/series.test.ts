import { describe, expect, it } from 'vitest'
import { addDays, dayKeys, fillSeries, formatDay, startOfDay, todayKey } from './series'

describe('todayKey', () => {
  it('is the date in the zone asked for, not in UTC', () => {
    const t = new Date('2026-10-01T23:30:00Z')
    expect(todayKey(t, 'UTC')).toBe('2026-10-01')
    expect(todayKey(t, 'Pacific/Auckland')).toBe('2026-10-02') // already tomorrow there
    expect(todayKey(t, 'America/Los_Angeles')).toBe('2026-10-01')
  })
  it('falls back to something sensible', () => {
    expect(todayKey(new Date('2026-10-01T10:00:00Z'), 'UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('day arithmetic', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('lays out n consecutive days ending today, oldest first, with no gaps over a daylight-saving change', () => {
    const k = dayKeys('2026-10-31', 7)
    expect(k).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
    const across = dayKeys('2026-11-03', 10) // spans the US clock change on Nov 1
    expect(new Set(across).size).toBe(10)
    for (let i = 1; i < across.length; i++) expect(addDays(across[i - 1], 1)).toBe(across[i])
  })
})

describe('fillSeries', () => {
  const keys = dayKeys('2026-10-05', 5)
  it('puts rows on their day, sums repeats (several shops or currencies), and zero-fills the rest', () => {
    const rows = [{ day: '2026-10-02', n: 2 }, { day: '2026-10-02', n: 3 }, { day: '2026-10-05', n: 1 }]
    expect(fillSeries(rows, keys, (r) => r.n)).toEqual([0, 5, 0, 0, 1])
  })
  it('ignores rows outside the range instead of failing', () => {
    expect(fillSeries([{ day: '2025-01-01', n: 9 }, { day: '2030-01-01', n: 9 }], keys, (r) => r.n)).toEqual([0, 0, 0, 0, 0])
  })
  it('handles no rows at all', () => {
    expect(fillSeries([], keys, () => 1)).toEqual([0, 0, 0, 0, 0])
  })
})

describe('startOfDay', () => {
  it('is the instant a calendar day begins in the zone (its local midnight)', () => {
    expect(startOfDay('2026-10-01', 'UTC').toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(startOfDay('2026-10-01', 'Pacific/Auckland').toISOString()).toBe('2026-09-30T11:00:00.000Z') // UTC+13 in October
    expect(startOfDay('2026-10-01', 'America/Los_Angeles').toISOString()).toBe('2026-10-01T07:00:00.000Z') // UTC-7
    expect(startOfDay('2026-10-01', 'Asia/Kolkata').toISOString()).toBe('2026-09-30T18:30:00.000Z') // a half-hour zone
    expect(startOfDay('2026-10-01', 'Europe/Skopje').toISOString()).toBe('2026-09-30T22:00:00.000Z') // UTC+2 in October
  })
  it('is right on the day the clocks change, and the day after', () => {
    // US clocks go back on 2026-11-01: that day is 25 hours long, midnight is still at UTC-7 and the next midnight at UTC-8
    expect(startOfDay('2026-11-01', 'America/Los_Angeles').toISOString()).toBe('2026-11-01T07:00:00.000Z')
    expect(startOfDay('2026-11-02', 'America/Los_Angeles').toISOString()).toBe('2026-11-02T08:00:00.000Z')
    // and a spring-forward day in Europe (2026-03-29)
    expect(startOfDay('2026-03-29', 'Europe/Berlin').toISOString()).toBe('2026-03-28T23:00:00.000Z')
    expect(startOfDay('2026-03-30', 'Europe/Berlin').toISOString()).toBe('2026-03-29T22:00:00.000Z')
  })
  it('agrees with todayKey: the instant it returns is on that day in the zone, and a second earlier is the day before', () => {
    for (const tz of ['UTC', 'Pacific/Auckland', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati']) {
      const start = startOfDay('2026-10-15', tz)
      expect(todayKey(start, tz)).toBe('2026-10-15')
      expect(todayKey(new Date(start.getTime() - 1000), tz)).toBe('2026-10-14')
    }
  })
})

describe('formatDay', () => {
  it('does not shift a date across the viewer\'s zone', () => {
    expect(formatDay('2026-10-03')).toContain('3')
    expect(formatDay('2026-10-03', { weekday: 'short' })).toMatch(/Sat|sat|сб/i) // Oct 3 2026 is a Saturday
  })
})
