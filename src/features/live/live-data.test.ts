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
  it('shows a shop pushing its products, naming who pressed the button and how many were sent', () => {
    const sync = (over: object = {}) => ({ id: 's1', integration_id: 'shopA', by_name: 'Marko', by_role: 'Admin', products: 1250, notified: 1, created_at: '2026-10-30T10:00:00Z', ...over })
    const [s] = mergeLive([], [], [], [sync()])
    expect(s).toMatchObject({ kind: 'sync', id: 's-s1', to: '/inventory', shopId: 'shopA', title: 'Marko (Admin) synced their products: 1,250 products' })
    expect(s.note).toBe('1 automation notified')
    expect(mergeLive([], [], [], [sync({ notified: 2 })])[0].note).toBe('2 automations notified')
    expect(mergeLive([], [], [], [sync({ notified: 0 })])[0].note).toBe('No automation was set up for this')
    expect(mergeLive([], [], [], [sync({ by_role: null })])[0].title).toBe('Marko synced their products: 1,250 products')
    expect(mergeLive([], [], [], [sync({ by_name: null })])[0].title).toBe('Admin synced their products: 1,250 products')
    expect(mergeLive([], [], [], [sync({ by_name: null, by_role: null, products: 0 })])[0].title).toBe('A shop synced their products')
  })

  it('puts a push among the other things, newest first', () => {
    const items = mergeLive([order('1', '2026-10-30T10:00:00Z')], [], [], [{ id: 's', integration_id: 'shopA', by_name: null, by_role: null, products: 3, notified: 0, created_at: '2026-10-30T10:00:30Z' }])
    expect(items.map((i) => i.kind)).toEqual(['sync', 'order'])
  })

  it('keeps only the newest few', () => {
    const many = Array.from({ length: 30 }, (_, i) => order(String(i), `2026-10-30T10:${String(i).padStart(2, '0')}:00Z`))
    const items = mergeLive(many, [], [], [], 14)
    expect(items).toHaveLength(14)
    expect(items[0].id).toBe('o-29')
  })
  it('handles nothing at all', () => {
    expect(mergeLive([], [], [])).toEqual([])
  })
})
