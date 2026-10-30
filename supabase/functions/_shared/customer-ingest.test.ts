import { beforeEach, describe, expect, it } from 'vitest'
import { handleCustomerWebhook } from './customer-ingest.ts'
import type { Logger } from './log.ts'
import { MemoryStore } from './memory-store.ts'

const KEY = `wr_live_${'d'.repeat(64)}`
const OTHER_KEY = `wr_live_${'e'.repeat(64)}`
const log: Logger = { info() {}, error() {} }

let store: MemoryStore
let shop: Awaited<ReturnType<MemoryStore['addIntegration']>>
const deps = () => ({ store, log })

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://x.test/customer-webhook', {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'shop-1', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const ev = (customer: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  event_id: 'c1',
  event_type: 'customer.created',
  occurred_at: '2026-10-27T10:00:00Z',
  customer: { email: 'ana@example.com', ...customer },
  ...over,
})
const send = (body: unknown, headers?: Record<string, string>) => handleCustomerWebhook(post(body, headers), deps())

beforeEach(async () => {
  store = new MemoryStore()
  shop = await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'shop-1', trackSignups: true })
})

describe('authentication', () => {
  it('rejects a missing, unknown or revoked key, a wrong store, and other methods', async () => {
    expect((await send(ev(), { authorization: '' })).status).toBe(401)
    expect((await send(ev(), { authorization: `Bearer ${OTHER_KEY}` })).status).toBe(401)
    expect((await send(ev(), { 'x-store-id': 'someone-else' })).status).toBe(403)
    expect((await handleCustomerWebhook(new Request('https://x.test', { method: 'GET' }), deps())).status).toBe(405)
    shop.status = 'revoked'
    expect((await send(ev())).status).toBe(401)
    expect(store.signups).toHaveLength(0)
  })

  it('refuses a key that is not bound to a store yet', async () => {
    const fresh = new MemoryStore()
    await fresh.addIntegration(KEY, { status: 'awaiting_bind', externalStoreId: null, trackSignups: true })
    expect((await handleCustomerWebhook(post(ev()), { store: fresh, log })).status).toBe(403)
  })
})

describe('the opt-in', () => {
  it('keeps the event as ignored, with a reason, when the shop has not switched signups on', async () => {
    shop.trackSignups = false
    const res = await send(ev())
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'ignored', reason: 'signups_disabled' })
    expect(store.signups).toHaveLength(0)
    expect(store.events[0]).toMatchObject({ status: 'ignored', error: expect.stringContaining('signups_off') })
  })

  it('does not show validation errors to a shop that has not opted in', async () => {
    shop.trackSignups = false
    expect((await send(ev({ email: 'not-an-email' }))).status).toBe(202)
  })

  it('processes the same event when the shop resends it after switching signups on', async () => {
    shop.trackSignups = false
    await send(ev())
    shop.trackSignups = true
    const res = await send(ev())
    expect(res.status).toBe(200)
    expect(store.signups).toHaveLength(1)
    expect(store.events[0].status).toBe('processed')
  })

  it('still treats a processed event as a duplicate', async () => {
    await send(ev())
    expect(await (await send(ev())).json()).toEqual({ status: 'duplicate' })
    expect(store.signups).toHaveLength(1)
  })

  it('reports the database saying it was switched off at the last moment', async () => {
    const original = store.applySignup.bind(store)
    store.applySignup = async (a) => {
      shop.trackSignups = false // switched off between the handler's check and the write
      return original(a)
    }
    const res = await send(ev())
    expect(res.status).toBe(202)
    expect(store.signups).toHaveLength(0)
  })
})

describe('signup events', () => {
  it('applies a customer.created with everything normalised', async () => {
    const res = await send(ev({ name: 'Ana Petrova', phone: '+389 70 111', external_id: 'cust_7', registered_at: '2026-10-27T09:00:00+01:00' }))
    expect(res.status).toBe(200)
    expect(store.signups[0]).toMatchObject({
      eventType: 'customer.created', integrationId: shop.id, organizationId: shop.organizationId, email: 'ana@example.com',
      name: 'Ana Petrova', phone: '+389 70 111', externalId: 'cust_7', occurredAt: '2026-10-27T10:00:00.000Z', registeredAt: '2026-10-27T08:00:00.000Z',
    })
  })

  it('accepts the smallest valid event: only the envelope and an email', async () => {
    expect((await send(ev())).status).toBe(200)
    expect(store.signups[0]).toMatchObject({ name: null, phone: null, externalId: null, registeredAt: null })
  })

  it('applies a customer.updated, and treats null like an absent field', async () => {
    const res = await send(ev({ name: null, phone: null }, { event_id: 'u1', event_type: 'customer.updated' }))
    expect(res.status).toBe(200)
    expect(store.signups[0]).toMatchObject({ eventType: 'customer.updated', name: null, phone: null })
  })

  it('takes the workspace and store from the key, never from the payload', async () => {
    await send({ ...ev(), organization_id: 'org_evil', integration_id: 'int_evil', customer: { email: 'ana@example.com', organization_id: 'org_evil' } })
    expect(store.signups[0].organizationId).toBe(shop.organizationId)
    expect(store.signups[0].integrationId).toBe(shop.id)
  })

  it('records unsupported event types as ignored', async () => {
    const res = await send(ev({}, { event_type: 'customer.deleted' }))
    expect(res.status).toBe(202)
    expect(store.events[0]).toMatchObject({ status: 'ignored', error: expect.stringContaining('unsupported') })
    expect(store.signups).toHaveLength(0)
  })
})

describe('bad input', () => {
  it('rejects a missing or invalid email without echoing it', async () => {
    const bad = await send(ev({ email: 'jane@@nowhere' }))
    expect(bad.status).toBe(400)
    const body = JSON.stringify(await bad.json())
    expect(body).toContain('customer.email')
    expect(body).not.toContain('jane@@nowhere')
    expect((await send({ ...ev(), customer: { name: 'No Email' } }, {})).status).toBe(400)
    expect(store.signups).toHaveLength(0)
    expect(store.events.every((e) => e.status === 'failed')).toBe(true)
  })

  it('rejects limits that the database could not hold', async () => {
    expect((await send(ev({ name: 'x'.repeat(201) }))).status).toBe(400)
    expect((await send(ev({ external_id: 'x'.repeat(201) }, { event_id: 'c2' }))).status).toBe(400)
    expect((await send(ev({}, { occurred_at: 'yesterday', event_id: 'c3' }))).status).toBe(400)
  })

  it('rejects malformed JSON and a missing event id, and lets a corrected resend through', async () => {
    expect((await send('{nope')).status).toBe(400)
    expect((await send({ event_type: 'customer.created', occurred_at: '2026-10-27T10:00:00Z', customer: { email: 'a@b.co' } })).status).toBe(400)
    await send(ev({ email: 'broken' }))
    expect((await send(ev())).status).toBe(200) // same event id, fixed payload: failed events are retried
  })

  it('answers 500 and marks the event failed when the store throws', async () => {
    store.applySignup = async () => { throw new Error('db down') }
    expect((await send(ev())).status).toBe(500)
    expect(store.events[0]).toMatchObject({ status: 'failed', error: 'internal error' })
  })
})
