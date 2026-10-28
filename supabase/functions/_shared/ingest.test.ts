import { beforeEach, describe, expect, it } from 'vitest'
import { handleBind, handleOrderWebhook } from './ingest.ts'
import type { Logger } from './log.ts'
import { MemoryStore } from './memory-store.ts'

const KEY = `wr_live_${'a'.repeat(64)}`
const OTHER_KEY = `wr_live_${'b'.repeat(64)}`
const log: Logger = { info() {}, error() {} }

let store: MemoryStore
const deps = () => ({ store, log })

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://x.test/fn', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'store-1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const ev = (over: Record<string, unknown> = {}, order: Record<string, unknown> = {}) => ({
  event_id: 'e1',
  event_type: 'order.created',
  occurred_at: '2026-10-27T10:00:00Z',
  order: { external_id: '1001', ...order },
  ...over,
})

beforeEach(async () => {
  store = new MemoryStore()
  await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'store-1' })
})

const only = () => [...store.orders.values()][0]

describe('authentication', () => {
  it('rejects missing, malformed, and unknown keys', async () => {
    expect((await handleOrderWebhook(post(ev(), { authorization: '' }), deps())).status).toBe(401)
    expect((await handleOrderWebhook(post(ev(), { authorization: 'Bearer nope' }), deps())).status).toBe(401)
    expect((await handleOrderWebhook(post(ev(), { authorization: `Bearer ${OTHER_KEY}` }), deps())).status).toBe(401)
  })

  it('rejects a request from a different store than the one bound', async () => {
    const res = await handleOrderWebhook(post(ev(), { 'x-store-id': 'store-2' }), deps())
    expect(res.status).toBe(403)
    expect(store.orders.size).toBe(0)
  })

  it('ignores an organization id supplied in the payload', async () => {
    await handleOrderWebhook(post({ ...ev(), organization_id: 'org_evil' }), deps())
    expect(JSON.stringify(only())).not.toContain('org_evil')
  })

  it('refuses events for an unbound integration', async () => {
    store = new MemoryStore()
    await store.addIntegration(KEY)
    expect((await handleOrderWebhook(post(ev()), deps())).status).toBe(403)
  })
})

describe('ingestion', () => {
  it('creates an order from a minimal payload and flags data quality', async () => {
    const res = await handleOrderWebhook(post(ev()), deps())
    expect(res.status).toBe(200)
    expect(only().status).toBe('unknown')
    expect(only().data_quality).toEqual(expect.arrayContaining(['missing_total', 'no_items', 'no_customer_contact']))
  })

  it('treats a repeated delivery as a duplicate without reprocessing', async () => {
    await handleOrderWebhook(post(ev()), deps())
    const res = await handleOrderWebhook(post(ev({}, { order_number: 'CHANGED' })), deps())
    expect(await res.json()).toEqual({ status: 'duplicate' })
    expect(only().order_number).toBeNull()
    expect(store.timeline).toHaveLength(1)
  })

  it('merges partial updates and clears on explicit null', async () => {
    await handleOrderWebhook(
      post(ev({}, { customer: { name: 'Ana', email: 'ana@example.com' }, notes: 'hello', currency: 'eur' })),
      deps(),
    )
    await handleOrderWebhook(
      post(ev({ event_id: 'e2', event_type: 'order.updated', occurred_at: '2026-10-27T11:00:00Z' }, { customer: { name: 'Ana B' }, notes: null })),
      deps(),
    )
    expect(only()).toMatchObject({ customer_name: 'Ana B', customer_email: 'ana@example.com', notes: null, currency: 'EUR' })
  })

  it('does not let an older out-of-order event overwrite newer state, but records it', async () => {
    await handleOrderWebhook(post(ev({ event_id: 'new', occurred_at: '2026-10-27T12:00:00Z' }, { status: 'completed' })), deps())
    await handleOrderWebhook(
      post(ev({ event_id: 'old', event_type: 'order.status_changed', occurred_at: '2026-10-27T09:00:00Z' }, { status: 'pending', order_number: 'A-1' })),
      deps(),
    )
    expect(only().status).toBe('completed')
    expect(only().order_number).toBe('A-1') // untouched key still applies
    const last = store.timeline.at(-1)!
    expect(last.data.stale).toEqual(['status'])
  })

  it('maps known statuses and falls back to unknown while keeping the original', async () => {
    await handleOrderWebhook(post(ev({}, { status: 'Shipped-ish', payment_status: 'CAPTURED', fulfillment_status: 'shipped' })), deps())
    expect(only()).toMatchObject({
      status: 'unknown',
      external_status: 'Shipped-ish',
      payment_status: 'paid',
      fulfillment_status: 'fulfilled',
    })
  })

  it('replaces line items only when items are present', async () => {
    await handleOrderWebhook(post(ev({}, { items: [{ sku: 'A', quantity: 1 }, { sku: 'B', quantity: 2 }] })), deps())
    await handleOrderWebhook(post(ev({ event_id: 'e2', occurred_at: '2026-10-27T11:00:00Z' }, { notes: 'x' })), deps())
    expect(store.items.get(only().id)).toHaveLength(2)
    await handleOrderWebhook(post(ev({ event_id: 'e3', occurred_at: '2026-10-27T12:00:00Z' }, { items: [{ sku: 'C' }] })), deps())
    expect(store.items.get(only().id)).toHaveLength(1)
  })
})

describe('round trips', () => {
  it('records the event, reads the order and touches the integration concurrently', async () => {
    const log2: string[] = []
    const wrap = <T,>(name: string, fn: () => Promise<T>) => async () => {
      log2.push(`start:${name}`)
      await new Promise((r) => setTimeout(r, 5))
      const v = await fn()
      log2.push(`end:${name}`)
      return v
    }
    const rec = store.recordEvent.bind(store), get = store.getOrder.bind(store), touch = store.touchIntegration.bind(store)
    store.recordEvent = ((e: any) => wrap('record', () => rec(e))()) as any
    store.getOrder = ((a: string, b: string) => wrap('get', () => get(a, b))()) as any
    store.touchIntegration = (() => wrap('touch', () => touch())()) as any
    expect((await handleOrderWebhook(post(ev()), deps())).status).toBe(200)
    const firstEnd = log2.findIndex((l) => l.startsWith('end:'))
    expect(log2.slice(0, firstEnd).sort()).toEqual(['start:get', 'start:record', 'start:touch'])
  })

  it('still produces correct results when the prefetched order is stale (concurrent change)', async () => {
    await handleOrderWebhook(post(ev({}, { order_number: 'A' })), deps())
    const real = store.getOrder.bind(store)
    let calls = 0
    // The first read returns a stale copy (as if another event landed in between); the version check must force a re-read.
    store.getOrder = (async (a: string, b: string) => {
      calls++
      const o = await real(a, b)
      return calls === 1 && o ? { ...o, version: o.version - 1 } : o
    }) as any
    const res = await handleOrderWebhook(post(ev({ event_id: 'e2', event_type: 'order.updated', occurred_at: '2026-10-27T11:00:00Z' }, { notes: 'later' })), deps())
    expect(res.status).toBe(200)
    expect(only()).toMatchObject({ order_number: 'A', notes: 'later' })
    expect(calls).toBe(2)
  })

  it('does not apply a prefetched order for an invalid or duplicate event', async () => {
    await handleOrderWebhook(post(ev()), deps())
    const before = JSON.stringify(only())
    expect(await (await handleOrderWebhook(post(ev({}, { order_number: 'CHANGED' })), deps())).json()).toEqual({ status: 'duplicate' })
    expect((await handleOrderWebhook(post(ev({ event_id: 'bad' }, { totals: { total_minor: 1.5 } })), deps())).status).toBe(400)
    expect(JSON.stringify(only())).toBe(before)
  })
})

describe('failures', () => {
  it('records malformed JSON as a failed event', async () => {
    const res = await handleOrderWebhook(post('{nope'), deps())
    expect(res.status).toBe(400)
    expect(store.events[0]).toMatchObject({ status: 'failed', error: 'malformed_json' })
  })

  it('rejects wrong types without echoing submitted values', async () => {
    const res = await handleOrderWebhook(post(ev({}, { totals: { total_minor: 'secret-ish 12.50' } })), deps())
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain('secret-ish')
    expect(store.events[0].status).toBe('failed')
    expect(store.orders.size).toBe(0)
  })

  it('rejects a missing order identity', async () => {
    const res = await handleOrderWebhook(post({ ...ev(), order: {} }), deps())
    expect(res.status).toBe(400)
  })

  it('records unsupported event types as ignored', async () => {
    const res = await handleOrderWebhook(post(ev({ event_type: 'order.deleted' })), deps())
    expect(res.status).toBe(202)
    expect(store.events[0].status).toBe('ignored')
  })

  it('allows a failed event to be retried with a corrected payload', async () => {
    await handleOrderWebhook(post(ev({}, { currency: 'EURO' })), deps())
    expect(store.events[0].status).toBe('failed')
    const res = await handleOrderWebhook(post(ev({}, { currency: 'EUR' })), deps())
    expect(res.status).toBe(200)
    expect(store.events).toHaveLength(1)
    expect(store.events[0].attempts).toBe(1)
  })

  it('retries on version conflicts and gives up with a retryable 503', async () => {
    store.forceConflicts = 2
    expect((await handleOrderWebhook(post(ev()), deps())).status).toBe(200)
    store.forceConflicts = 10
    const res = await handleOrderWebhook(post(ev({ event_id: 'e2' })), deps())
    expect(res.status).toBe(503)
    expect(store.events.find((e) => e.eventId === 'e2')?.status).toBe('failed')
  })
})

describe('bind', () => {
  beforeEach(async () => {
    store = new MemoryStore()
    await store.addIntegration(KEY)
  })
  const bind = (body: unknown, key = KEY) =>
    handleBind(post(body, { authorization: `Bearer ${key}` }), deps())

  it('binds once, is idempotent for the same store, and refuses another store', async () => {
    expect((await (await bind({ store_id: 'store-1', base_url: 'https://shop.test' })).json())).toEqual({ status: 'bound' })
    expect(await (await bind({ store_id: 'store-1' })).json()).toEqual({ status: 'already_bound' })
    expect((await bind({ store_id: 'store-2' })).status).toBe(403)
  })

  it('refuses a store already connected to another integration', async () => {
    await bind({ store_id: 'store-1' })
    await store.addIntegration(OTHER_KEY)
    expect((await bind({ store_id: 'store-1' }, OTHER_KEY)).status).toBe(409)
  })

  it('requires https base_url and a store id', async () => {
    expect((await bind({ store_id: 'x', base_url: 'http://shop.test' })).status).toBe(400)
    expect((await bind({})).status).toBe(400)
  })
})
