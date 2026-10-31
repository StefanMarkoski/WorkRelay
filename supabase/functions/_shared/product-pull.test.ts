import { describe, expect, it } from 'vitest'
import type { Logger } from './log.ts'
import { pullDueProducts, type DueSync, type PullHttp, type PullStore } from './product-pull.ts'

const log: Logger = { info() {}, error() {} }
const SENT_AT = new Date('2026-10-30T12:00:00Z')

function setup(due: DueSync[], reply: (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>) {
  const applied: { integrationId: string; items: Record<string, unknown>[]; at: string; trigger?: 'scheduled' | 'manual' }[] = []
  const records: [string, string | null, number | undefined][] = []
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
  }
  const http: PullHttp = { get: reply }
  const run = () => pullDueProducts({ store, http, log, now: () => SENT_AT })
  return { applied, records, run }
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
