import { describe, expect, it } from 'vitest'
import type { Caller } from './auth.ts'
import type { Logger } from './log.ts'
import type { DueSync, PullStore } from './product-pull.ts'
import { handleSyncNow, REFUSALS, type ClaimedCall, type SyncNowDeps } from './sync-now.ts'

const SHOP = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a01'
const log: Logger = { info() {}, error() {} }

function setup(opts: { caller?: Caller; claim?: () => Promise<ClaimedCall>; answer?: { status: number; body: string } | Error } = {}) {
  const claims: [string, string][] = []
  const gets: { url: string; headers: Record<string, string> }[] = []
  const applied: { integrationId: string; items: Record<string, unknown>[] }[] = []
  const records: [string, string | null, number | undefined][] = []
  const store: PullStore = {
    async claimDue() { return [] as DueSync[] },
    async apply(a) { applied.push(a); return a.items.length },
    async record(id, e, n) { records.push([id, e, n]) },
  }
  const deps: SyncNowDeps = {
    getCaller: async () => opts.caller ?? { ok: true, id: 'user-1' },
    claim: async (u, i) => {
      claims.push([u, i])
      return opts.claim ? opts.claim() : { sourceUrl: 'https://shop.test/products', authHeader: 'Bearer s3cret', callsLeft: 4 }
    },
    pull: {
      store,
      http: {
        async get(url, headers) {
          gets.push({ url, headers })
          const a = opts.answer ?? { status: 200, body: JSON.stringify({ products: [{ sku: 'A', stock: 3 }, { sku: 'B', stock: 9 }] }) }
          if (a instanceof Error) throw a
          return a
        },
      },
      log,
    },
  }
  const call = (body: unknown = { integration_id: SHOP }, method = 'POST') =>
    handleSyncNow(new Request('https://x.test/sync-now', { method, headers: { authorization: 'Bearer t' }, body: method === 'POST' ? JSON.stringify(body) : undefined }), deps)
  return { call, claims, gets, applied, records }
}
const refusing = (code: string) => async (): Promise<ClaimedCall> => { throw new Error(code) }

describe('who can ask', () => {
  it('needs a signed-in user, and does nothing for anyone else', async () => {
    const t = setup({ caller: { ok: false, reason: 'expired' } })
    expect((await t.call()).status).toBe(401)
    expect(t.claims).toHaveLength(0)
    expect(t.gets).toHaveLength(0)
  })
  it('only answers POST', async () => {
    expect((await setup().call(undefined, 'GET')).status).toBe(405)
  })
  it('turns a "forbidden" from the database into 403 and never touches the shop', async () => {
    const t = setup({ claim: refusing('forbidden') })
    expect((await t.call()).status).toBe(403)
    expect(t.gets).toHaveLength(0)
  })
  it('hands the database the signed-in user and the shop, never trusting a user id from the body', async () => {
    const t = setup()
    await t.call({ integration_id: SHOP, user_id: 'someone-else' })
    expect(t.claims).toEqual([['user-1', SHOP]])
  })
})

describe('the gates', () => {
  it.each(Object.keys(REFUSALS))('%s: refused with a readable reason, the shop is not called', async (code) => {
    const t = setup({ claim: refusing(code) })
    const res = await t.call()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: code, detail: REFUSALS[code] })
    expect(t.gets).toHaveLength(0)
    expect(t.applied).toHaveLength(0)
  })
  it('does not leak an unexpected database error', async () => {
    const t = setup({ claim: refusing('relation "integration_sync" does not exist') })
    const res = await t.call()
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('integration_sync')
  })
  it('rejects a body that is not a shop id', async () => {
    for (const body of [null, {}, { integration_id: 'nope' }, { integration_id: 5 }]) {
      const t = setup()
      expect((await t.call(body)).status, JSON.stringify(body)).toBe(400)
      expect(t.claims).toHaveLength(0)
    }
  })
})

describe('the pull itself', () => {
  it('asks the shop\'s URL with its saved Authorization, applies the products, records it, and says how many calls are left', async () => {
    const t = setup()
    const res = await t.call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', products: 2, calls_left: 4 })
    expect(t.gets).toEqual([{ url: 'https://shop.test/products', headers: { accept: 'application/json', authorization: 'Bearer s3cret' } }])
    expect(t.applied[0].items.map((i) => i.sku)).toEqual(['A', 'B'])
    expect(t.records).toEqual([[SHOP, null, 2]]) // shows in Event history like a scheduled pull
  })
  it('sends no Authorization when the shop has none saved', async () => {
    const t = setup({ claim: async () => ({ sourceUrl: 'https://shop.test/p', authHeader: null, callsLeft: 1 }) })
    await t.call()
    expect(t.gets[0].headers).toEqual({ accept: 'application/json' })
  })
  it.each([
    ['a non-2xx answer', { status: 503, body: '' }, 'HTTP 503'],
    ['text that is not JSON', { status: 200, body: '<html>' }, 'not valid JSON'],
    ['the wrong shape', { status: 200, body: '{"items":[]}' }, 'Unexpected response'],
    ['a network failure', new Error('The request timed out'), 'timed out'],
  ])('%s: the call is still spent, the error is reported and recorded, nothing is applied', async (_l, answer, text) => {
    const t = setup({ answer })
    const res = await t.call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('failed')
    expect(body.error).toContain(text)
    expect(body.calls_left).toBe(4)
    expect(t.applied).toHaveLength(0)
    expect(t.records[0][1]).toContain(text)
  })
  it('never puts the shop\'s Authorization value in any response', async () => {
    for (const answer of [undefined, { status: 500, body: 'Bearer s3cret' }, new Error('Bearer s3cret')]) {
      const res = await setup({ answer }).call()
      expect(await res.text()).not.toContain('s3cret')
    }
  })
})
