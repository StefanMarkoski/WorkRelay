import { beforeEach, describe, expect, it } from 'vitest'
import { handleInventoryWebhook } from './inventory-ingest.ts'
import type { Logger } from './log.ts'
import { MemoryStore } from './memory-store.ts'

const KEY = `wr_live_${'f'.repeat(64)}`
const OTHER_KEY = `wr_live_${'a'.repeat(64)}`
const log: Logger = { info() {}, error() {} }

let store: MemoryStore
let shop: Awaited<ReturnType<MemoryStore['addIntegration']>>
const deps = () => ({ store, log })

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://x.test/inventory-webhook', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'shop-1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
const send = (body: unknown, headers?: Record<string, string>) => handleInventoryWebhook(post(body, headers), deps())

beforeEach(async () => {
  store = new MemoryStore()
  shop = await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'shop-1' })
  store.pushEnabled.add(shop.id)
})

describe('authentication', () => {
  it('rejects a missing, unknown or revoked key, a wrong store, and other methods', async () => {
    expect((await send({ products: [] }, { authorization: '' })).status).toBe(401)
    expect((await send({ products: [] }, { authorization: `Bearer ${OTHER_KEY}` })).status).toBe(401)
    expect((await send({ products: [] }, { 'x-store-id': 'someone-else' })).status).toBe(403)
    expect((await handleInventoryWebhook(new Request('https://x.test', { method: 'GET' }), deps())).status).toBe(405)
    shop.status = 'revoked'
    expect((await send({ products: [{ sku: 'A' }] })).status).toBe(401)
    expect(store.productReports).toHaveLength(0)
  })
})

describe('the opt-in', () => {
  it('ignores a push from a shop that has not switched pushing on', async () => {
    store.pushEnabled.clear()
    const res = await send({ products: [{ sku: 'A', stock: 1 }] })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'ignored', reason: 'inventory_push_disabled' })
    expect(store.productReports).toHaveLength(0)
  })
})

describe('Event history', () => {
  it('records an applied push as a short summary, never the whole feed', async () => {
    const products = Array.from({ length: 30 }, (_, i) => ({ sku: `S${i}`, stock: i }))
    await send({ products })
    expect(store.events).toHaveLength(1)
    expect(store.events[0]).toMatchObject({ status: 'processed', integrationId: shop.id })
    expect(store.events[0].rawPayload).toEqual({ products: 30, skus: products.slice(0, 10).map((p) => p.sku) })
  })

  it('records a push that was ignored because pushing is off, with the reason', async () => {
    store.pushEnabled.clear()
    await send({ products: [{ sku: 'A', stock: 1 }] })
    expect(store.events[0]).toMatchObject({ status: 'ignored', error: expect.stringContaining('inventory_push_disabled') })
  })

  it('records a rejected push as failed, with the field but not the value, and keeps the body out', async () => {
    await send({ products: [{ sku: 'secret@x.com', stock: 'many' }] })
    expect(store.events[0]).toMatchObject({ status: 'failed', rawPayload: { rejected: true } })
    expect(store.events[0].error).toContain('products.0.stock')
    expect(JSON.stringify(store.events[0])).not.toContain('secret@x.com')
    await send('not json{')
    expect(store.events[1]).toMatchObject({ status: 'failed', error: 'malformed_json' })
  })

  it('gives every push its own event, so a repeated report is never blocked as a duplicate', async () => {
    await send({ products: [{ sku: 'A', stock: 1 }] })
    await send({ products: [{ sku: 'A', stock: 1 }] })
    expect(new Set(store.events.map((e) => e.eventId)).size).toBe(2)
    expect(store.productReports).toHaveLength(2)
  })

  it('never fails a push because the history could not be written', async () => {
    store.recordEvent = async () => { throw new Error('db down') }
    expect((await send({ products: [{ sku: 'A', stock: 1 }] })).status).toBe(200)
  })

  it('records nothing for a bad key', async () => {
    await send({ products: [{ sku: 'A' }] }, { authorization: `Bearer ${OTHER_KEY}` })
    expect(store.events).toHaveLength(0)
  })
})

describe('telling the team a shop synced', () => {
  it('announces a push, naming who pressed the button, with how many products were applied', async () => {
    await send({ products: [{ sku: 'A', stock: 1 }, { sku: 'B', stock: 2 }], synced_by: { name: ' Marko ', role: 'Admin' } })
    expect(store.announcements).toEqual([{ integrationId: shop.id, byName: 'Marko', byRole: 'Admin', products: 2 }])
  })

  it('still announces when the shop does not say who (the team is then told the shop did it)', async () => {
    await send({ products: [{ sku: 'A', stock: 1 }] })
    expect(store.announcements).toEqual([{ integrationId: shop.id, byName: null, byRole: null, products: 1 }])
  })

  it('treats a blank name or role as not given, and accepts just one of them', async () => {
    await send({ products: [{ sku: 'A' }], synced_by: { name: '   ', role: 'Manager' } })
    await send({ products: [{ sku: 'A' }], synced_by: { name: 'Ana', role: null } })
    expect(store.announcements.map((a) => [a.byName, a.byRole])).toEqual([[null, 'Manager'], ['Ana', null]])
  })

  it('stays silent for a push marked quiet (an automatic background job)', async () => {
    expect((await send({ products: [{ sku: 'A', stock: 1 }], quiet: true })).status).toBe(200)
    expect(store.productReports).toHaveLength(1) // the stock was still applied
    expect(store.announcements).toHaveLength(0)
    await send({ products: [{ sku: 'A', stock: 1 }], quiet: false })
    expect(store.announcements).toHaveLength(1)
  })

  it('announces nothing when quick sync is not allowed, when the push is rejected, or when there was nothing in it', async () => {
    store.pushEnabled.clear()
    await send({ products: [{ sku: 'A', stock: 1 }], synced_by: { name: 'Marko' } })
    store.pushEnabled.add(shop.id)
    await send({ products: [{ sku: 'A', stock: 'many' }], synced_by: { name: 'Marko' } })
    await send({ products: [], synced_by: { name: 'Marko' } })
    expect(store.announcements).toHaveLength(0)
  })

  it('never fails a push that was applied because the announcement could not be made', async () => {
    store.failAnnouncements = true
    const res = await send({ products: [{ sku: 'A', stock: 1 }], synced_by: { name: 'Marko' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'processed', applied: 1 })
    expect(store.productReports).toHaveLength(1)
  })

  it('rejects a malformed synced_by or quiet, naming the field and never the value', async () => {
    for (const body of [
      { products: [], synced_by: 'Marko' },
      { products: [], synced_by: { name: 5 } },
      { products: [], synced_by: { name: 'x'.repeat(121) } },
      { products: [], synced_by: { role: 'x'.repeat(61) } },
      { products: [], quiet: 'yes' },
    ]) {
      const res = await send(body)
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400)
    }
    const detail = (await (await send({ products: [], synced_by: { name: 5 } })).json()).detail as string
    expect(detail).toContain('synced_by.name')
    expect(store.announcements).toHaveLength(0)
  })
})

describe('the payload', () => {
  it('needs only a sku; everything else is optional and nulls mean "unchanged"', async () => {
    const res = await send({ products: [{ sku: ' BIKE-1 ' }, { sku: 'NAIL-1', name: null, stock: null, notify_on: null, price_minor: null }] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'processed', applied: 2 })
    expect(store.productReports[0]).toMatchObject({ source: 'push', integrationId: shop.id })
    expect(store.productReports[0].items).toEqual([{ sku: 'BIKE-1' }, { sku: 'NAIL-1' }])
  })

  it('passes the optional fields through, normalises the time and ignores unknown extras', async () => {
    await send({
      products: [{ sku: 'B', name: 'Bike', stock: 4, notify_on: 5, price_minor: 90000, currency: 'EUR', unit: 'pcs',
        category: 'bikes', barcode: '123', updated_at: '2026-10-30T10:00:00+02:00', warehouse: 'north', anything: { a: 1 } }],
    })
    expect(store.productReports[0].items[0]).toEqual({
      sku: 'B', name: 'Bike', stock: 4, notify_on: 5, price_minor: 90000, currency: 'EUR', unit: 'pcs', category: 'bikes',
      barcode: '123', updated_at: '2026-10-30T08:00:00.000Z',
    })
  })

  it('accepts zero stock and a negative stock, and an empty list', async () => {
    expect((await send({ products: [{ sku: 'A', stock: 0 }, { sku: 'B', stock: -2 }] })).status).toBe(200)
    expect((await send({ products: [] })).status).toBe(200)
  })

  it('rejects bad input with paths only, and applies nothing', async () => {
    const cases: unknown[] = [
      'not json{',
      {},
      { products: 'x' },
      { products: [{ name: 'no sku' }] },
      { products: [{ sku: '' }] },
      { products: [{ sku: 'A', stock: 1.5 }] },
      { products: [{ sku: 'A', notify_on: -1 }] },
      { products: [{ sku: 'A', price_minor: 100 }] }, // price needs a currency
      { products: [{ sku: 'A', updated_at: 'yesterday' }] },
    ]
    for (const c of cases) {
      const res = await send(c)
      expect(res.status).toBe(400)
    }
    expect(store.productReports).toHaveLength(0)
    const detail = (await (await send({ products: [{ sku: 'secret@x.com', stock: 'many' }] })).json()).detail as string
    expect(detail).toContain('products.0.stock')
    expect(detail).not.toContain('secret@x.com')
  })

  it('refuses more than 500 products in one push', async () => {
    const products = Array.from({ length: 501 }, (_, i) => ({ sku: `S${i}` }))
    expect((await send({ products })).status).toBe(400)
  })
})
