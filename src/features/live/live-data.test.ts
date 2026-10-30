import { describe, expect, it } from 'vitest'
import { mergeLive } from './live-data'

const order = (id: string, at: string, over: object = {}) => ({ id, order_number: `#${id}`, external_id: id, customer_name: 'Ana', total_minor: 4999, currency: 'EUR', created_at: at, integration_id: 'shopA', ...over })
const run = (id: string, at: string, over: object = {}) => ({ id, status: 'succeeded', created_at: at, started_at: null, context: { order: { integration_id: 'shopA' } }, workflows: { name: 'Notify Discord' }, ...over })
const approval = (id: string, at: string) => ({ id, title: 'Review large order', status: 'pending', created_at: at, context: { event: { integration_id: 'shopB' } } })

describe('mergeLive', () => {
  it('puts orders, runs and approvals in one list, newest first', () => {
    const items = mergeLive([order('1', '2026-10-30T10:00:00Z')], [run('r', '2026-10-30T10:00:05Z')], [approval('a', '2026-10-30T09:59:00Z')])
    expect(items.map((i) => i.kind)).toEqual(['run', 'order', 'approval'])
    expect(items.map((i) => i.id)).toEqual(['r-r', 'o-1', 'a-a'])
  })
  it('describes an order the way the Orders page does, and copes with missing details', () => {
    const [full] = mergeLive([order('1', '2026-10-30T10:00:00Z')], [], [])
    expect(full.title).toContain('#1')
    expect(full.title).toContain('from Ana')
    expect(full.to).toBe('/orders/1')
    const [bare] = mergeLive([order('2', '2026-10-30T10:00:00Z', { order_number: null, customer_name: null, total_minor: null })], [], [])
    expect(bare.title).toBe('New order #2')
  })
  it('reads each item\'s shop from the order column or the run/approval context', () => {
    const items = mergeLive([order('1', '2026-10-30T10:00:00Z')], [run('r', '2026-10-30T09:00:00Z')], [approval('a', '2026-10-30T08:00:00Z')])
    expect(items.map((i) => i.shopId)).toEqual(['shopA', 'shopA', 'shopB'])
  })
  it('uses when a run started rather than when it was queued, and links runs to their detail', () => {
    const [r] = mergeLive([], [run('r', '2026-10-30T10:00:00Z', { started_at: '2026-10-30T10:00:09Z' })], [])
    expect(r.at).toBe('2026-10-30T10:00:09Z')
    expect(r.to).toBe('/executions/r')
    expect(r.status).toBe('succeeded')
  })
  it('keeps only the newest few', () => {
    const many = Array.from({ length: 30 }, (_, i) => order(String(i), `2026-10-30T10:${String(i).padStart(2, '0')}:00Z`))
    const items = mergeLive(many, [], [], 14)
    expect(items).toHaveLength(14)
    expect(items[0].id).toBe('o-29')
  })
  it('handles nothing at all', () => {
    expect(mergeLive([], [], [])).toEqual([])
  })
})
