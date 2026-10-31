/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { customerWebhookSchema } from './customer-contract.ts'
import { handleCustomerWebhook } from './customer-ingest.ts'
import { handleOrderWebhook } from './ingest.ts'
import { PULL_MAX_PRODUCTS, PUSH_MAX_PRODUCTS, inventoryEnvelope, productSchema } from './inventory-contract.ts'
import { handleInventoryWebhook } from './inventory-ingest.ts'
import type { Logger } from './log.ts'
import { MemoryStore } from './memory-store.ts'
import { orderWebhookSchema } from './order-contract.ts'
import { pullShop } from './product-pull.ts'

const root = new URL('../../../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const doc = read('documentation/shop-developer-guide.md')
const log: Logger = { info() {}, error() {} }
const KEY = `wr_live_${'d'.repeat(64)}`

const jsonBlocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]) as Record<string, any>)
const orderExamples = jsonBlocks.filter((j) => String(j.event_type ?? '').startsWith('order.'))
const signupExamples = jsonBlocks.filter((j) => String(j.event_type ?? '').startsWith('customer.'))
const feedExamples = jsonBlocks.filter((j) => Array.isArray(j.products))

/** Each `-d '{...}'` in the guide's curl examples, with the endpoint it is sent to. */
const curlBodies = [...doc.matchAll(/"\$BASE\/(order-webhook|customer-webhook|inventory-webhook)"[^\n]*\\\n\s+-d '(\{.*\})'/g)].map((m) => ({ endpoint: m[1], body: JSON.parse(m[2]) }))

describe('the developer guide: its examples are real', () => {
  it('has the examples it promises', () => {
    expect(orderExamples.map((e) => e.event_id)).toEqual(['ord_1001:created'])
    expect(signupExamples.map((e) => e.event_id)).toEqual(['cust_77:created'])
    expect(feedExamples).toHaveLength(1)
    expect(curlBodies.map((c) => c.endpoint)).toEqual(['order-webhook', 'customer-webhook', 'inventory-webhook'])
  })

  it('every example validates against the real schema', () => {
    for (const e of orderExamples) expect(orderWebhookSchema.safeParse(e).success, e.event_id).toBe(true)
    for (const e of signupExamples) expect(customerWebhookSchema.safeParse(e).success, e.event_id).toBe(true)
    for (const e of feedExamples) expect(inventoryEnvelope(PUSH_MAX_PRODUCTS).safeParse(e).success).toBe(true)
    for (const c of curlBodies) {
      const schema = c.endpoint === 'order-webhook' ? orderWebhookSchema : c.endpoint === 'customer-webhook' ? customerWebhookSchema : inventoryEnvelope(PUSH_MAX_PRODUCTS)
      expect(schema.safeParse(c.body).success, `${c.endpoint}: ${JSON.stringify(c.body)}`).toBe(true)
    }
  })

  it('the order example makes a customer from its email, and its items carry a SKU', async () => {
    const store = new MemoryStore()
    const shop = await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'shop-1' })
    const res = await handleOrderWebhook(
      new Request('https://x.test/order-webhook', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'shop-1' }, body: JSON.stringify(orderExamples[0]) }),
      { store, log },
    )
    expect(res.status).toBe(200)
    expect(await store.getOrder(shop.id, '1001')).toMatchObject({ customer_email: 'ana@example.com', customer_name: 'Ana Petrova' })
    expect([...store.items.values()][0]).toMatchObject([{ sku: 'TEE-BLK-M' }])
  })

  it('a signup is applied for a shop with signups on, and ignored (as the guide says) for one without', async () => {
    const send = async (trackSignups: boolean) => {
      const store = new MemoryStore()
      await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'shop-1', trackSignups })
      return handleCustomerWebhook(
        new Request('https://x.test/customer-webhook', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'shop-1' }, body: JSON.stringify(signupExamples[0]) }),
        { store, log },
      )
    }
    expect((await send(true)).status).toBe(200)
    const off = await send(false)
    expect(off.status).toBe(202)
    expect(await off.json()).toEqual({ status: 'ignored', reason: 'signups_disabled' })
  })

  it('a stock push from a connected shop is applied', async () => {
    const push = async () => {
      const store = new MemoryStore()
      await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'shop-1' })
      return handleInventoryWebhook(
        new Request('https://x.test/inventory-webhook', { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'shop-1' }, body: JSON.stringify(feedExamples[0]) }),
        { store, log },
      )
    }
    const ok = await push()
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ status: 'processed', applied: 2 })
  })

  it('the products endpoint format is accepted by the scheduled pull, as an object or as a bare list', async () => {
    const pull = async (body: unknown) => {
      let applied = 0
      const out = await pullShop(
        { integrationId: 'i', sourceUrl: 'https://shop.test/p', authHeader: 'Bearer token' },
        {
          store: { async claimDue() { return [] }, async apply(a) { applied += a.items.length; return a.items.length }, async record() {} },
          http: { async get() { return { status: 200, body: JSON.stringify(body) } } },
          log,
        },
      )
      return { out, applied }
    }
    expect((await pull(feedExamples[0])).applied).toBe(2)
    const list = await pull(feedExamples[0].products)
    expect(list.out).toEqual({ ok: true, products: 2 })
    for (const p of feedExamples[0].products) expect(productSchema.safeParse(p).success).toBe(true)
  })
})

describe('the developer guide: its numbers and names are the real ones', () => {
  it('states the limits the code enforces', () => {
    expect(doc).toContain(`Up to **${PUSH_MAX_PRODUCTS} products and 1 MB per request**`)
    expect(doc).toContain(`**${PULL_MAX_PRODUCTS.toLocaleString('en-US')} products and 5 MB**`)
    expect(doc).toContain('**15 seconds**')
    const client = read('supabase/functions/_shared/pull-client.ts')
    expect(client).toContain('15_000')
    expect(client).toContain('5_000_000')
    expect(read('supabase/migrations/0016_inventory_followups.sql')).toContain("interval '30 days'")
    expect(doc).toContain('for 30 days')
  })

  it('documents the push fields that really exist, and the message the automation really sends', () => {
    const contract = read('supabase/functions/_shared/inventory-contract.ts')
    const presets = read('supabase/functions/_shared/presets.ts')
    expect(doc).toContain('synced_by')
    expect(contract).toContain('synced_by')
    expect(contract).not.toContain('quiet: optional') // the shop cannot switch notifications off from the request
    expect(doc).not.toContain('"quiet"')
    expect(doc).toContain('has synced their products')
    expect(presets).toContain('has synced their products')
    expect(doc).toContain('within 90 seconds')
    expect(read('supabase/migrations/0025_sync_announcement_window.sql')).toContain("interval '90 seconds'")
  })

  it('uses the response codes the handlers really send', () => {
    expect(read('supabase/functions/_shared/inventory-ingest.ts')).not.toContain('inventory_push_disabled') // there is no switch to be refused by
    expect(read('supabase/functions/_shared/customer-ingest.ts')).toContain('signups_disabled')
    expect(doc).toContain('signups_disabled')
    expect(doc).not.toContain('inventory_push_disabled')
  })

  it.each([
    ['Receive customer signups', 'src/features/integrations/edit-shop.tsx'],
    ['Connect store', 'src/pages/integrations-page.tsx'],
    ['Placed an order', 'src/pages/customers-page.tsx'],
    ['Registered only', 'src/pages/customers-page.tsx'],
    ['a customer signs up', 'src/pages/automations-page.tsx'],
    ['a new customer places their first order', 'src/pages/automations-page.tsx'],
    ['Sync now', 'src/features/integrations/sync-now-button.tsx'],
    ['a shop syncs its products', 'src/pages/automations-page.tsx'],
    ['The last check failed', 'src/pages/settings-api-calls-page.tsx'],
    ['Not reported', 'src/pages/inventory-page.tsx'],
  ])('refers to "%s", which is really in the app', (label, file) => {
    expect(doc.toLowerCase()).toContain(label.toLowerCase())
    expect(read(file).toLowerCase()).toContain(label.toLowerCase())
  })

  it('links only to files that exist', () => {
    const links = [...doc.matchAll(/\]\(\.\/([^)#]+)\)/g)].map((m) => m[1])
    expect(links.length).toBeGreaterThan(3)
    for (const f of links) expect(existsSync(new URL(`documentation/${f}`, root)), f).toBe(true)
  })

  it('names the base URL the reference guide names', () => {
    const base = 'https://wayktzmupzrdcwosgnfg.supabase.co/functions/v1'
    expect(doc).toContain(base)
    expect(read('documentation/shop-webhook-integration.md')).toContain(base)
  })
})
