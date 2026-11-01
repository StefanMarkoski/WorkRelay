import { describe, expect, it } from 'vitest'
import type { Logger } from './log.ts'
import { pullDueProducts, type DueSync, type PullHttp, type PullStore } from './product-pull.ts'

const log: Logger = { info() {}, error() {} }
const SENT_AT = new Date('2026-10-30T12:00:00Z')

function setup(due: DueSync[], reply: (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>) {
  const applied: { integrationId: string; items: Record<string, unknown>[]; at: string; trigger?: 'scheduled' | 'manual' | 'before_push' | 'after_push' }[] = []
  const records: [string, string | null, number | undefined][] = []
  const marks: [string, boolean][] = []
  const store: PullStore = {
    async claimDue() {
      return due
    },
    async apply(a) {
      applied.push(a)
      return a.items.length
    },
    async record(id, error, count) {
      records.push([id, error, count])
    },
    async markFeedFilter(id, supported) {
      marks.push([id, supported])
    },
  }
  const http: PullHttp = { get: reply }
  const run = () => pullDueProducts({ store, http, log, now: () => SENT_AT })
  return { applied, records, marks, run }
}
const shop = (over: Partial<DueSync> = {}): DueSync => ({ integrationId: 'i1', sourceUrl: 'https://shop.test/stock', authHeader: null, ...over })
const ok = (value: unknown) => async () => ({ status: 200, body: JSON.stringify(value) })

describe('a successful pull', () => {
  it('applies the products stamped with the time the request was sent, and records success', async () => {
    const t = setup([shop()], ok({ products: [{ sku: 'BIKE-1', stock: 4, notify_on: 5 }] }))
    expect(await t.run()).toEqual({ pulled: 1, failed: 0 })
    expect(t.applied).toEqual([{ integrationId: 'i1', items: [{ sku: 'BIKE-1', stock: 4, notify_on: 5 }], at: SENT_AT.toISOString() }])
    expect(t.records).toEqual([['i1', null, 1]]) // the count of products applied is recorded for Event history
  })

  it('tells the store whether a person or the schedule started it, for the sync history', async () => {
    const t = setup([shop({ trigger: 'manual' }), shop({ integrationId: 'i2' })], ok({ products: [{ sku: 'A', stock: 1 }] }))
    await t.run()
    expect(t.applied.map((a) => [a.integrationId, a.trigger])).toEqual([['i1', 'manual'], ['i2', undefined]])
  })

  it('accepts a bare list as well as { products }', async () => {
    const t = setup([shop()], ok([{ sku: 'A' }]))
    expect((await t.run()).pulled).toBe(1)
    expect(t.applied[0].items).toEqual([{ sku: 'A' }])
  })

  it('sends the shop\'s own authorization value to its own url only', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    const t = setup([shop({ authHeader: 'Bearer abc' })], async (url, headers) => {
      seen.push({ url, headers })
      return { status: 200, body: '{"products":[]}' }
    })
    await t.run()
    expect(seen).toEqual([{ url: 'https://shop.test/stock', headers: { accept: 'application/json', authorization: 'Bearer abc' } }])
  })

  it('treats an empty product list as a valid answer', async () => {
    const t = setup([shop()], ok({ products: [] }))
    expect((await t.run()).pulled).toBe(1)
  })
})

describe('failures are recorded for the tenant and never applied', () => {
  it.each([
    ['a non-2xx answer', async () => ({ status: 503, body: '' }), 'HTTP 503'],
    ['text that is not JSON', async () => ({ status: 200, body: '<html>' }), 'not valid JSON'],
    ['the wrong shape', ok({ items: [] }), 'Unexpected response'],
    ['a product without a sku', ok({ products: [{ name: 'x' }] }), 'products.0.sku'],
    ['a network error', async () => { throw new Error('The request timed out') }, 'timed out'],
  ])('%s', async (_label, reply, message) => {
    const t = setup([shop()], reply)
    expect(await t.run()).toEqual({ pulled: 0, failed: 1 })
    expect(t.applied).toHaveLength(0)
    expect(t.records).toHaveLength(1)
    expect(t.records[0][1]).toContain(message)
  })

  it('does not echo submitted values or the response body into the error', async () => {
    const t = setup([shop()], ok({ products: [{ sku: 'a@b.com', stock: 'many' }] }))
    await t.run()
    expect(t.records[0][1]).not.toContain('a@b.com')
  })

  it('one failing shop does not stop the others', async () => {
    const t = setup([shop({ integrationId: 'bad', sourceUrl: 'https://bad.test' }), shop({ integrationId: 'good' })], async (url) =>
      url.includes('bad') ? { status: 500, body: '' } : { status: 200, body: '{"products":[{"sku":"A"}]}' })
    expect(await t.run()).toEqual({ pulled: 1, failed: 1 })
    expect(t.applied.map((a) => a.integrationId)).toEqual(['good'])
  })
})

describe('the shop\'s saved Authorization value', () => {
  it('is scrubbed from any error before it is stored or shown', async () => {
    const t = setup([shop({ authHeader: 'Bearer s3cret-token' })], async () => { throw new Error('upstream said: bad credential Bearer s3cret-token') })
    await t.run()
    expect(t.records[0][1]).toBe('upstream said: bad credential [hidden]')
  })
  it('leaves messages alone when there is nothing to hide', async () => {
    const t = setup([shop()], async () => { throw new Error('The request timed out') })
    await t.run()
    expect(t.records[0][1]).toBe('The request timed out')
  })
})

describe('nothing due', () => {
  it('does nothing', async () => {
    const t = setup([], ok({}))
    expect(await t.run()).toEqual({ pulled: 0, failed: 0 })
  })
})

describe('a read for write-back asks only for the SKUs that matter', () => {
  const asking = (over: Partial<DueSync> = {}) => shop({ trigger: 'before_push', skus: ['A-1', 'B 2'], useFilter: true, filterState: null, ...over })

  it('adds ?skus=, comma-separated and encoded, to the shop\'s own address (keeping what is already in it)', async () => {
    const seen: string[] = []
    const t = setup([asking({ sourceUrl: 'https://shop.test/stock?lang=en' })], async (url) => { seen.push(url); return { status: 200, body: '{"products":[{"sku":"A-1","stock":1}]}' } })
    await t.run()
    const u = new URL(seen[0])
    expect(u.searchParams.get('skus')).toBe('A-1,B 2')
    expect(u.searchParams.get('lang')).toBe('en')
    expect(seen[0]).not.toContain(' ')
  })

  it('learns that a shop honours the filter when the answer holds only what was asked, and says so once', async () => {
    const t = setup([asking()], ok({ products: [{ sku: 'A-1', stock: 1 }] }))
    await t.run()
    expect(t.marks).toEqual([['i1', true]])
    const again = setup([asking({ filterState: true })], ok({ products: [{ sku: 'B 2', stock: 1 }] }))
    await again.run()
    expect(again.marks).toEqual([]) // already known: no call
  })

  it('learns that a shop ignored it when the answer held more, and still applies the whole answer', async () => {
    const t = setup([asking()], ok({ products: [{ sku: 'A-1', stock: 1 }, { sku: 'OTHER', stock: 5 }] }))
    await t.run()
    expect(t.marks).toEqual([['i1', false]])
    expect(t.applied[0].items.map((i) => i.sku)).toEqual(['A-1', 'OTHER'])
  })

  it('a shop known to honour it that suddenly sends everything is marked as ignoring it', async () => {
    const t = setup([asking({ filterState: true })], ok({ products: [{ sku: 'A-1', stock: 1 }, { sku: 'OTHER', stock: 5 }] }))
    await t.run()
    expect(t.marks).toEqual([['i1', false]])
  })

  it('an ignored filter tried again after a week is noted again, so it is not tried at every read', async () => {
    const t = setup([asking({ filterState: false })], ok({ products: [{ sku: 'A-1', stock: 1 }, { sku: 'OTHER', stock: 5 }] }))
    await t.run()
    expect(t.marks).toEqual([['i1', false]])
  })

  it('an empty answer proves nothing about the filter', async () => {
    const t = setup([asking()], ok({ products: [] }))
    await t.run()
    expect(t.marks).toEqual([])
  })

  it('does not filter when the database says not to, or when there is nothing to ask for, or for a scheduled read', async () => {
    const seen: string[] = []
    const reply = async (url: string) => { seen.push(url); return { status: 200, body: '{"products":[]}' } }
    await setup([asking({ useFilter: false }), asking({ skus: [] }), shop()], reply).run()
    expect(seen).toEqual(['https://shop.test/stock', 'https://shop.test/stock', 'https://shop.test/stock'])
  })
})
