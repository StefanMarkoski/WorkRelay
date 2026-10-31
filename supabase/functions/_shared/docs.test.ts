/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { customerWebhookSchema } from './customer-contract.ts'
import { handleCustomerWebhook } from './customer-ingest.ts'
import { handleOrderWebhook } from './ingest.ts'
import { PULL_MAX_PRODUCTS, PUSH_MAX_PRODUCTS, inventoryEnvelope } from './inventory-contract.ts'
import { handleInventoryWebhook } from './inventory-ingest.ts'
import type { Logger } from './log.ts'
import { MemoryStore } from './memory-store.ts'
import { mapFulfillmentStatus, mapOrderStatus, mapPaymentStatus } from './normalize.ts'
import { orderWebhookSchema } from './order-contract.ts'
import { pullDueProducts } from './product-pull.ts'

const doc = readFileSync(new URL('../../../documentation/shop-webhook-integration.md', import.meta.url), 'utf8')
const log: Logger = { info() {}, error() {} }
const KEY = `wr_live_${'c'.repeat(64)}`

/** Every fenced json block in the guide that is an order event, in document order. */
const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]) as Record<string, any>)
const events = jsonBlocks.filter((j) => String(j.event_type ?? '').startsWith('order.'))
const customerEvents = jsonBlocks.filter((j) => String(j.event_type ?? '').startsWith('customer.'))
const feeds = jsonBlocks.filter((j) => Array.isArray(j.products))

describe('shop integration guide', () => {
  it('has the examples it promises', () => {
    expect(events.map((e) => e.event_id)).toEqual([
      'ord_1001:created', 'ord_1001:status:completed:2026-10-27T12:30:00Z', 'ord_1001:updated:2026-10-27T13:00:00Z', 'ord_1002:created',
    ])
  })

  it('every example validates against the real schema', () => {
    for (const e of events) expect(orderWebhookSchema.safeParse(e).success, e.event_id).toBe(true)
  })

  it('the examples behave as the guide describes when sent in order', async () => {
    const store = new MemoryStore()
    const ref = await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'shop-eu-001' })
    for (const e of events) {
      const res = await handleOrderWebhook(
        new Request('https://x.test/order-webhook', {
          method: 'POST',
          headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'shop-eu-001' },
          body: JSON.stringify(e),
        }),
        { store, log },
      )
      expect(res.status, e.event_id).toBe(200)
    }
    const o1001 = await store.getOrder(ref.id, '1001')
    expect(o1001).toMatchObject({
      order_number: '#1001', currency: 'EUR', total_minor: 4999, customer_name: 'Ana Petrova', customer_email: 'ana@example.com',
      status: 'completed', fulfillment_status: 'fulfilled', payment_status: 'paid', notes: 'Leave at the door',
    })
    expect(o1001?.customer_phone).toBeNull() // cleared by the explicit null
    expect(o1001?.shipping_address).toMatchObject({ city: 'Skopje' }) // untouched by partial updates
    expect(store.items.get(store.orders.get(`${ref.id}:1001`)!.id)).toHaveLength(1)
    expect(await store.getOrder(ref.id, '1002')).not.toBeNull() // smallest valid event creates an order
  })

  it('repeating an example is reported as a duplicate', async () => {
    const store = new MemoryStore()
    await store.addIntegration(KEY, { status: 'connected', externalStoreId: 's' })
    const send = () => handleOrderWebhook(new Request('https://x.test', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 's' }, body: JSON.stringify(events[0]) }), { store, log })
    expect((await send()).status).toBe(200)
    expect(await (await send()).json()).toEqual({ status: 'duplicate' })
  })

  it('documented status words map as documented', () => {
    const cases: [typeof mapOrderStatus, Record<string, string[]>][] = [
      [mapOrderStatus, { pending: ['pending', 'new', 'open', 'awaiting_payment'], processing: ['processing', 'confirmed', 'in_progress'], completed: ['completed', 'complete', 'delivered', 'closed'], cancelled: ['cancelled', 'canceled', 'void'] }],
      [mapPaymentStatus as any, { unpaid: ['unpaid', 'pending'], authorized: ['authorized'], paid: ['paid', 'captured', 'succeeded'], partially_refunded: ['partially_refunded'], refunded: ['refunded'], failed: ['failed', 'declined'] }],
      [mapFulfillmentStatus as any, { unfulfilled: ['unfulfilled', 'pending', 'not_shipped'], partial: ['partial', 'partially_fulfilled'], fulfilled: ['fulfilled', 'shipped', 'delivered'], returned: ['returned'] }],
    ]
    for (const [fn, table] of cases) for (const [value, words] of Object.entries(table)) for (const w of words) expect(fn(w), w).toBe(value)
    expect(mapOrderStatus('Awaiting Payment')).toBe('pending') // case and spaces
    expect(mapOrderStatus('somethingelse')).toBe('unknown')
  })

  it('the committed JSON Schema matches the validator', () => {
    const generated = { title: 'WorkRelay order webhook event', ...z.toJSONSchema(orderWebhookSchema, { io: 'input', unrepresentable: 'any' }) }
    const committed = JSON.parse(readFileSync(new URL('../../../documentation/order-webhook.schema.json', import.meta.url), 'utf8'))
    expect(committed).toEqual(generated)
  })

  it('the customer signup example validates, is accepted for a shop that switched signups on, and is ignored for one that did not', async () => {
    expect(customerEvents.map((e) => e.event_id)).toEqual(['cust_77:created'])
    expect(customerWebhookSchema.safeParse(customerEvents[0]).success).toBe(true)
    const send = (store: MemoryStore) =>
      handleCustomerWebhook(new Request('https://x.test/customer-webhook', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 's' }, body: JSON.stringify(customerEvents[0]) }), { store, log })
    const on = new MemoryStore()
    await on.addIntegration(KEY, { status: 'connected', externalStoreId: 's', trackSignups: true })
    expect((await send(on)).status).toBe(200)
    const off = new MemoryStore()
    await off.addIntegration(KEY, { status: 'connected', externalStoreId: 's' })
    const res = await send(off)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'ignored', reason: 'signups_disabled' })
  })

  it('the committed customer JSON Schema matches the validator', () => {
    const generated = { title: 'WorkRelay customer webhook event', ...z.toJSONSchema(customerWebhookSchema, { io: 'input', unrepresentable: 'any' }) }
    const committed = JSON.parse(readFileSync(new URL('../../../documentation/customer-webhook.schema.json', import.meta.url), 'utf8'))
    expect(committed).toEqual(generated)
  })
  describe('products and stock', () => {
    const push = (store: MemoryStore, body: unknown, headers: Record<string, string> = {}) =>
      handleInventoryWebhook(
        new Request('https://x.test/inventory-webhook', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 's', ...headers }, body: JSON.stringify(body) }),
        { store, log },
      )

    it('has the feed example it promises, and it validates against the real schema', () => {
      expect(feeds).toHaveLength(1)
      expect(feeds[0].products.map((p: { sku: string }) => p.sku)).toEqual(['BIKE-ROAD-700', 'NAIL-100'])
      expect(inventoryEnvelope(PUSH_MAX_PRODUCTS).safeParse(feeds[0]).success).toBe(true)
      expect(feeds[0].products[1]).toEqual({ sku: 'NAIL-100', stock: 4800, notify_on: 5000 }) // the "only what you know" example
    })

    it('the example is applied by any connected shop', async () => {
      const on = new MemoryStore()
      await on.addIntegration(KEY, { status: 'connected', externalStoreId: 's' })
      const ok = await push(on, feeds[0])
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({ status: 'processed', applied: 2 })
    })

    it('the curl example in the guide is a valid push', async () => {
      const curl = doc.match(/inventory-webhook" .*\n.*\n  -d '(\{.*\})'/)
      expect(curl).not.toBeNull()
      expect(inventoryEnvelope(PUSH_MAX_PRODUCTS).safeParse(JSON.parse(curl![1])).success).toBe(true)
    })

    it('a pull answer in either documented shape is accepted, and a wrong one is reported', async () => {
      const run = async (body: string) => {
        const records: (string | null)[] = []
        let applied = 0
        await pullDueProducts({
          store: {
            async claimDue() { return [{ integrationId: 'i', sourceUrl: 'https://shop.test/p', authHeader: null }] },
            async apply(a) { applied += a.items.length; return a.items.length },
            async record(_id, e, _count) { records.push(e) },
          },
          http: { async get() { return { status: 200, body } } },
          log,
        })
        return { applied, records }
      }
      expect(await run(JSON.stringify(feeds[0]))).toEqual({ applied: 2, records: [null] })
      expect(await run(JSON.stringify(feeds[0].products))).toEqual({ applied: 2, records: [null] })
      const bad = await run('{"items":[]}')
      expect(bad.applied).toBe(0)
      expect(bad.records[0]).toContain('Unexpected response')
    })

    it('the limits the guide states are the limits in the code', () => {
      expect(doc).toContain(`up to ${PUSH_MAX_PRODUCTS} products`)
      expect(doc).toContain(`up to **${PULL_MAX_PRODUCTS.toLocaleString('en-US')} products and 5 MB**`)
      expect(inventoryEnvelope(PUSH_MAX_PRODUCTS).safeParse({ products: Array.from({ length: PUSH_MAX_PRODUCTS + 1 }, (_, i) => ({ sku: `S${i}` })) }).success).toBe(false)
    })

    it('the committed product JSON Schema matches the validator', () => {
      const generated = { title: 'WorkRelay product feed (push body and pull answer)', ...z.toJSONSchema(inventoryEnvelope(PULL_MAX_PRODUCTS), { io: 'input', unrepresentable: 'any' }) }
      const committed = JSON.parse(readFileSync(new URL('../../../documentation/product-feed.schema.json', import.meta.url), 'utf8'))
      expect(committed).toEqual(generated)
    })
  })
})
