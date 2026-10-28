/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { handleOrderWebhook } from './ingest.ts'
import type { Logger } from './log.ts'
import { MemoryStore } from './memory-store.ts'
import { mapFulfillmentStatus, mapOrderStatus, mapPaymentStatus } from './normalize.ts'
import { orderWebhookSchema } from './order-contract.ts'

const doc = readFileSync(new URL('../../../documentation/shop-webhook-integration.md', import.meta.url), 'utf8')
const log: Logger = { info() {}, error() {} }
const KEY = `wr_live_${'c'.repeat(64)}`

/** Every fenced json block in the guide that is an order event, in document order. */
const events = [...doc.matchAll(/```json\n([\s\S]*?)```/g)]
  .map((m) => JSON.parse(m[1]) as Record<string, any>)
  .filter((j) => 'event_type' in j)

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
})
