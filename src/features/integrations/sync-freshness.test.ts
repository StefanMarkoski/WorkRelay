import { afterEach, describe, expect, it, vi } from 'vitest'
import { freshnessText, lastSynced } from './sync-freshness'

const NOW = Date.parse('2026-10-31T12:00:00Z')
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString()

afterEach(() => vi.useRealTimers())

describe('lastSynced', () => {
  it('is empty for a shop that has never been synced, or has no settings at all', () => {
    expect(lastSynced(null)).toEqual({ at: null, how: null, by: null })
    expect(lastSynced(undefined)).toEqual({ at: null, how: null, by: null })
    expect(lastSynced({ last_sync_at: null, last_push_at: null, last_push_by: null })).toEqual({ at: null, how: null, by: null })
  })
  it('knows a shop that only pushes (it has never been checked by WorkRelay)', () => {
    expect(lastSynced({ last_sync_at: null, last_push_at: ago(5), last_push_by: 'Marko (Admin)' })).toEqual({ at: ago(5), how: 'push', by: 'Marko (Admin)' })
  })
  it('knows a shop that is only checked', () => {
    expect(lastSynced({ last_sync_at: ago(46), last_push_at: null, last_push_by: null })).toEqual({ at: ago(46), how: 'check', by: null })
  })
  it('takes the later of the two, and says who only for a push', () => {
    expect(lastSynced({ last_sync_at: ago(46), last_push_at: ago(5), last_push_by: 'Ana' })).toMatchObject({ how: 'push', by: 'Ana' })
    expect(lastSynced({ last_sync_at: ago(5), last_push_at: ago(46), last_push_by: 'Ana' })).toEqual({ at: ago(5), how: 'check', by: null })
  })
  it('compares times, not text: the same instant written with different precision is not "earlier"', () => {
    const f = lastSynced({ last_sync_at: '2026-10-31T11:00:00.100000+00:00', last_push_at: '2026-10-31T11:00:00.5+00:00', last_push_by: null })
    expect(f.how).toBe('push')
    const g = lastSynced({ last_sync_at: '2026-10-31T11:00:00+00:00', last_push_at: '2026-10-31T10:59:59.999999+00:00', last_push_by: null })
    expect(g.how).toBe('check')
  })
})

describe('freshnessText', () => {
  it('says how long ago and by which route', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(freshnessText({ at: ago(12), how: 'push', by: 'Marko (Admin)' })).toBe('synced 12m ago, sent by Marko (Admin)')
    expect(freshnessText({ at: ago(12), how: 'push', by: null })).toBe('synced 12m ago, sent by the shop')
    expect(freshnessText({ at: ago(180), how: 'check', by: null })).toBe('synced 3h ago, checked by WorkRelay')
    expect(freshnessText({ at: ago(0), how: 'push', by: null })).toBe('synced just now, sent by the shop')
  })
  it('says so when there has been no sync', () => {
    expect(freshnessText({ at: null, how: null, by: null })).toBe('not synced yet')
  })
})
