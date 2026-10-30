import { describe, expect, it } from 'vitest'
import { callsLeftText, syncNowState } from './sync-now-state'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString()
const ok = { source_url: 'https://shop.example/p', calls: 15, days: 1, paused: false, window_start: hoursAgo(5), window_used: 4 }

describe('syncNowState: the gates', () => {
  it('is not available until the platform admin has set a schedule', () => {
    for (const sync of [null, undefined, { ...ok, calls: null, days: null }]) {
      const s = syncNowState(sync, NOW)
      expect(s.available).toBe(false)
      expect(s).toMatchObject({ reason: expect.stringContaining('Ask WorkRelay') })
    }
  })
  it('needs the products URL, and says where to add it', () => {
    expect(syncNowState({ ...ok, source_url: null }, NOW)).toMatchObject({ available: false, reason: expect.stringContaining('products URL') })
  })
  it('is not available while paused, and says how to undo it', () => {
    expect(syncNowState({ ...ok, paused: true }, NOW)).toMatchObject({ available: false, reason: expect.stringContaining('paused') })
  })
  it('checks the gates in a fixed order: schedule first, then URL, then pause', () => {
    expect(syncNowState({ ...ok, calls: null, days: null, source_url: null, paused: true }, NOW)).toMatchObject({ reason: expect.stringContaining('Ask WorkRelay') })
    expect(syncNowState({ ...ok, source_url: null, paused: true }, NOW)).toMatchObject({ reason: expect.stringContaining('products URL') })
  })
})

describe('syncNowState: the budget', () => {
  it('counts the calls left in the current window', () => {
    expect(syncNowState(ok, NOW)).toMatchObject({ available: true, callsLeft: 11, total: 15 })
  })
  it('has the full budget before the first call, and again once the window has renewed', () => {
    expect(syncNowState({ ...ok, window_start: null, window_used: 0 }, NOW)).toMatchObject({ available: true, callsLeft: 15, resetsAt: null })
    expect(syncNowState({ ...ok, window_start: hoursAgo(25), window_used: 15 }, NOW)).toMatchObject({ available: true, callsLeft: 15 })
  })
  it('is not available when the window has no calls left, and says when it renews', () => {
    const s = syncNowState({ ...ok, window_used: 15 }, NOW)
    expect(s).toMatchObject({ available: false, reason: expect.stringContaining('used all 15') })
  })
  it('never goes below zero, even if the shop somehow used more than its budget', () => {
    expect(syncNowState({ ...ok, window_used: 99 }, NOW).available).toBe(false)
  })
  it('knows a multi-day window: 5 calls a week, 2 days in', () => {
    const week = { ...ok, calls: 5, days: 7, window_start: hoursAgo(48), window_used: 3 }
    expect(syncNowState(week, NOW)).toMatchObject({ available: true, callsLeft: 2 })
    expect(syncNowState({ ...week, window_start: hoursAgo(24 * 7 + 1) }, NOW)).toMatchObject({ callsLeft: 5 }) // renewed
  })
})

describe('callsLeftText', () => {
  it('speaks in the unit the budget is set in', () => {
    const s = syncNowState(ok, NOW)
    if (!s.available) throw new Error('expected available')
    expect(callsLeftText(s, 1)).toBe('11 of 15 calls left today')
    expect(callsLeftText(s, 7)).toBe('11 of 15 calls left this 7-day period')
  })
})
