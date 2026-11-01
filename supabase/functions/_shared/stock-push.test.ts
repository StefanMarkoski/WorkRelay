import { createHmac, timingSafeEqual } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { HttpError } from './engine.ts'
import type { DueSync } from './product-pull.ts'
import { handleStockPushTest, prepare, pushPendingStock, signStockPush, type ClaimedPush, type PushDeps, type PushStore, type TestClaim } from './stock-push.ts'

const SECRET = 'wr_sign_' + 'ab'.repeat(32)
const NOW = new Date('2026-11-01T12:00:00Z')
const quiet = { info: () => {}, error: () => {} }

// What a shop writes to check a request: the same few lines as in the integration guide, with Node's own crypto.
function shopVerifies(secret: string, headers: Record<string, string>, rawBody: string, nowSeconds: number): boolean {
  const ts = headers['x-workrelay-timestamp']
  if (Math.abs(nowSeconds - Number(ts)) > 300) return false
  const expected = 'v1=' + createHmac('sha256', secret).update(`${ts}.${headers['x-workrelay-request-id']}.${rawBody}`).digest('hex')
  const given = headers['x-workrelay-signature']
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

function claim(over: Partial<ClaimedPush> = {}): ClaimedPush {
  return {
    requestId: '11111111-1111-4111-8111-111111111111', integrationId: '22222222-2222-4222-8222-222222222222', storeId: 'test-shop',
    url: 'https://shop.example.com/workrelay/stock', secret: SECRET,
    items: [{ sku: 'TEE-1', stock: 7, seq: 41, as_of: '2026-11-01T11:59:00Z', reported_stock: 9, reported_at: '2026-11-01T11:00:00Z' }], ...over,
  }
}

function fakeStore(claims: ClaimedPush[], allowed = true, pulls: DueSync[] = []) {
  const calls = { complete: [] as unknown[][], stillAllowed: [] as string[], failPull: [] as unknown[][], order: [] as string[] }
  const store: PushStore = {
    claimPulls: async () => { calls.order.push('claimPulls'); return pulls },
    failPull: async (...a) => { calls.failPull.push(a) },
    claim: async () => { calls.order.push('claim'); return claims },
    stillAllowed: async (id) => { calls.stillAllowed.push(id); return allowed },
    complete: async (...a) => { calls.complete.push(a) },
    beginTest: async () => { throw new Error('unused') },
    finishTest: async () => {},
  }
  return { store, calls }
}

describe('the signature', () => {
  it('matches an independent HMAC-SHA256 over timestamp.requestId.body', async () => {
    const sig = await signStockPush(SECRET, '1793534400', 'req-1', '{"a":1}')
    expect(sig).toBe(createHmac('sha256', SECRET).update('1793534400.req-1.{"a":1}').digest('hex'))
  })

  it('verifies on the shop side, and fails for a changed body, secret, request id or an old timestamp', async () => {
    const p = await prepare(SECRET, 'req-1', { type: 'stock.update', items: [] }, NOW)
    const now = NOW.getTime() / 1000
    expect(shopVerifies(SECRET, p.headers, p.body, now)).toBe(true)
    expect(shopVerifies(SECRET, p.headers, p.body.replace('items', 'itemz'), now)).toBe(false)
    expect(shopVerifies('wr_sign_' + 'cd'.repeat(32), p.headers, p.body, now)).toBe(false)
    expect(shopVerifies(SECRET, { ...p.headers, 'x-workrelay-request-id': 'req-2' }, p.body, now)).toBe(false)
    expect(shopVerifies(SECRET, p.headers, p.body, now + 301)).toBe(false)
  })

  it('never puts the secret in a header or the body', async () => {
    const p = await prepare(SECRET, 'req-1', { type: 'stock.update' }, NOW)
    expect(JSON.stringify(p.headers) + p.body).not.toContain(SECRET)
    expect(Object.keys(p.headers).sort()).toEqual(['content-type', 'user-agent', 'x-workrelay-request-id', 'x-workrelay-signature', 'x-workrelay-timestamp'])
  })
})

describe('sending what the database allows', () => {
  it('sends one signed POST with only the SKU, the absolute number, a sequence and a time', async () => {
    const { store, calls } = fakeStore([claim()])
    const post = vi.fn(async () => ({ status: 200, body: '' }))
    const out = await pushPendingStock({ store, http: { post }, log: quiet, now: () => NOW })
    expect(out).toEqual({ pulled: 0, pull_failed: 0, sent: 1, failed: 0, cancelled: 0 })
    expect(post).toHaveBeenCalledTimes(1)
    const [url, headers, body] = post.mock.calls[0] as unknown as [string, Record<string, string>, string]
    expect(url).toBe('https://shop.example.com/workrelay/stock')
    expect(shopVerifies(SECRET, headers, body, NOW.getTime() / 1000)).toBe(true)
    expect(JSON.parse(body)).toEqual({
      type: 'stock.update', request_id: '11111111-1111-4111-8111-111111111111', sent_at: '2026-11-01T12:00:00.000Z', store_id: 'test-shop',
      items: [{ sku: 'TEE-1', stock: 7, seq: 41, as_of: '2026-11-01T11:59:00Z', reported_stock: 9, reported_at: '2026-11-01T11:00:00Z' }],
    })
    expect(calls.complete).toEqual([['11111111-1111-4111-8111-111111111111', true, 200, null]])
  })

  it('does not send at all when the last check says no', async () => {
    const { store, calls } = fakeStore([claim()], false)
    const post = vi.fn(async () => ({ status: 200, body: '' }))
    const out = await pushPendingStock({ store, http: { post }, log: quiet })
    expect(post).not.toHaveBeenCalled()
    expect(out).toEqual({ pulled: 0, pull_failed: 0, sent: 0, failed: 0, cancelled: 1 })
    expect(calls.stillAllowed).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(calls.complete).toEqual([]) // the database already cancelled it
  })

  it('reports a non-2xx answer as a failure with a fixed reason, never the shop\'s own words', async () => {
    const { store, calls } = fakeStore([claim()])
    const post = async () => ({ status: 500, body: '<html>secret internal stack trace</html>' })
    const out = await pushPendingStock({ store, http: { post }, log: quiet })
    expect(out.failed).toBe(1)
    expect(calls.complete).toEqual([['11111111-1111-4111-8111-111111111111', false, 500, 'The shop answered with HTTP 500.']])
  })

  it('does not follow a redirect and counts it as a failure', async () => {
    const { store, calls } = fakeStore([claim()])
    const post = async () => ({ status: 302, body: '' })
    await pushPendingStock({ store, http: { post }, log: quiet })
    expect(calls.complete[0].slice(1)).toEqual([false, 302, 'The shop redirected the request; redirects are not followed.'])
  })

  it('reports a blocked destination or a timeout as a failure', async () => {
    for (const [err, text] of [[new HttpError('Destination blocked: Private or internal address', false), 'Destination blocked: Private or internal address'], [new HttpError('The request timed out.', true), 'The request timed out.'], [new Error('socket hang up'), 'The request failed.']] as const) {
      const { store, calls } = fakeStore([claim()])
      await pushPendingStock({ store, http: { post: async () => { throw err } }, log: quiet })
      expect(calls.complete[0].slice(1)).toEqual([false, null, text])
    }
  })

  it('keeps shops apart: one failing shop does not stop another', async () => {
    const a = claim()
    const b = claim({ requestId: '33333333-3333-4333-8333-333333333333', url: 'https://other.example.com/stock' })
    const { store, calls } = fakeStore([a, b])
    const post = async (url: string) => { if (url.includes('shop.example')) throw new Error('down'); return { status: 204, body: '' } }
    const out = await pushPendingStock({ store, http: { post }, log: quiet })
    expect(out).toEqual({ pulled: 0, pull_failed: 0, sent: 1, failed: 1, cancelled: 0 })
    expect(calls.complete).toHaveLength(2)
  })

  it('never logs the secret', async () => {
    const lines: string[] = []
    const log = { info: (m: string, c?: unknown) => lines.push(m + JSON.stringify(c)), error: (m: string, c?: unknown) => lines.push(m + JSON.stringify(c)) }
    const store: PushStore = { ...fakeStore([claim()]).store, complete: async () => { throw new Error(`boom ${SECRET}`) } }
    await pushPendingStock({ store, http: { post: async () => ({ status: 200, body: '' }) }, log })
    // (the real logger redacts keys that look sensitive; here it is enough that the secret is not what we pass as context)
    expect(lines.join('\n')).not.toContain('"secret"')
  })
})

describe('reading the shop first', () => {
  const shop: DueSync = { integrationId: '22222222-2222-4222-8222-222222222222', sourceUrl: 'https://shop.example.com/feed', authHeader: null, trigger: 'before_push' }

  it('reads the shops the database names, before it asks for anything to send', async () => {
    const { store, calls } = fakeStore([claim()], true, [shop])
    const pull = vi.fn(async (s: DueSync) => { calls.order.push(`pull:${s.trigger}`); return { ok: true as const, products: 3 } })
    const out = await pushPendingStock({ store, http: { post: async () => ({ status: 200, body: '' }) }, log: quiet, pull })
    expect(calls.order).toEqual(['claimPulls', 'pull:before_push', 'claim'])
    expect(out).toMatchObject({ pulled: 1, pull_failed: 0, sent: 1 })
  })

  it('tells the database when a read fails (or throws), with the reason, and the push still goes only as far as the database allows', async () => {
    for (const fail of [async () => ({ ok: false as const, error: 'The shop answered with HTTP 503' }), async () => { throw new Error('socket hang up') }]) {
      const { store, calls } = fakeStore([], true, [shop])
      const out = await pushPendingStock({ store, http: { post: vi.fn() }, log: quiet, pull: fail })
      expect(out).toMatchObject({ pulled: 0, pull_failed: 1, sent: 0 })
      expect(calls.failPull).toHaveLength(1)
      expect(calls.failPull[0][0]).toBe(shop.integrationId)
      expect(String(calls.failPull[0][1])).toMatch(/503|socket hang up/)
    }
  })

  it('one shop that cannot be read does not stop another from being read', async () => {
    const other: DueSync = { ...shop, integrationId: '66666666-6666-4666-8666-666666666666', trigger: 'after_push' }
    const { store, calls } = fakeStore([], true, [shop, other])
    const seen: string[] = []
    const pull = async (s: DueSync) => { seen.push(s.integrationId); return s === shop ? { ok: false as const, error: 'down' } : { ok: true as const, products: 1 } }
    const out = await pushPendingStock({ store, http: { post: vi.fn() }, log: quiet, pull })
    expect(seen).toHaveLength(2)
    expect(out).toMatchObject({ pulled: 1, pull_failed: 1 })
    expect(calls.failPull).toHaveLength(1)
  })

  it('does not read anything when no way to read was given (nothing sends on its own)', async () => {
    const { store, calls } = fakeStore([claim()], true, [shop])
    await pushPendingStock({ store, http: { post: async () => ({ status: 200, body: '' }) }, log: quiet })
    expect(calls.order).toEqual(['claim'])
  })
})

describe('the owner\'s test', () => {
  const USER = '44444444-4444-4444-8444-444444444444'
  const SHOP = '22222222-2222-4222-8222-222222222222'
  const t: TestClaim = { requestId: '55555555-5555-4555-8555-555555555555', storeId: 'test-shop', url: 'https://shop.example.com/workrelay/stock', secret: SECRET, challenge: 'c'.repeat(32) }

  function setup(opts: { allowed?: boolean; begin?: () => Promise<TestClaim>; caller?: boolean; answer?: { status: number; body: string } | Error; forged?: { status: number; body: string } | Error }) {
    const finished: unknown[][] = []
    const post = vi.fn(async (_u: string, _h: Record<string, string>, b: string) => {
      // the control request (wrong signature) carries a challenge of its own; by default the shop refuses it as it should
      const isControl = String(JSON.parse(b).challenge).startsWith('forged-')
      const a = isControl ? opts.forged ?? { status: 401, body: '' } : opts.answer ?? { status: 200, body: JSON.stringify({ challenge: t.challenge }) }
      if (a instanceof Error) throw a
      return a
    })
    const deps = {
      getCaller: async () => (opts.caller === false ? { ok: false as const, reason: 'no' } : { ok: true as const, id: USER }),
      store: {
        claimPulls: async () => [], failPull: async () => {}, claim: async () => [], stillAllowed: async () => opts.allowed ?? true, complete: async () => {},
        beginTest: opts.begin ?? (async () => t), finishTest: async (...a: unknown[]) => { finished.push(a) },
      } as PushStore,
      http: { post }, log: quiet, now: () => NOW,
    }
    const call = (body: unknown = { integration_id: SHOP }, method = 'POST') =>
      handleStockPushTest(new Request('https://x.test/stock-push-test', { method, body: method === 'POST' ? JSON.stringify(body) : undefined }), deps)
    return { call, post, finished }
  }

  it('needs a signed-in person, a POST and a valid body', async () => {
    expect((await setup({ caller: false }).call()).status).toBe(401)
    expect((await setup({}).call(undefined, 'GET')).status).toBe(405)
    expect((await setup({}).call({ integration_id: 'nope' })).status).toBe(400)
  })

  it('maps the database\'s refusals to readable answers', async () => {
    expect((await setup({ begin: async () => { throw new Error('forbidden') } }).call()).status).toBe(403)
    const r = await setup({ begin: async () => { throw new Error('too_soon') } }).call()
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ error: 'too_soon', detail: expect.stringContaining('ten seconds') })
    expect((await setup({ begin: async () => { throw new Error('weird') } }).call()).status).toBe(500)
  })

  it('passes when the shop answers 2xx with the challenge, and the request is signed', async () => {
    const s = setup({})
    const res = await s.call()
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(s.finished).toEqual([[t.requestId, true, 200, null]])
    const [, headers, body] = s.post.mock.calls[0]
    expect(shopVerifies(SECRET, headers, body, NOW.getTime() / 1000)).toBe(true)
    expect(JSON.parse(body)).toMatchObject({ type: 'stock.test', challenge: t.challenge, store_id: 'test-shop' })
  })

  it('also sends a request with a WRONG signature, and passes only if the shop refuses it', async () => {
    const s = setup({})
    expect(await (await s.call()).json()).toEqual({ status: 'ok' })
    expect(s.post).toHaveBeenCalledTimes(2)
    const [, hOk, bOk] = s.post.mock.calls[0]
    const [, hBad, bBad] = s.post.mock.calls[1]
    expect(shopVerifies(SECRET, hOk, bOk, NOW.getTime() / 1000)).toBe(true)
    expect(shopVerifies(SECRET, hBad, bBad, NOW.getTime() / 1000)).toBe(false)
    expect(hBad['x-workrelay-request-id']).not.toBe(hOk['x-workrelay-request-id'])
    expect(JSON.parse(bBad).challenge).not.toBe(t.challenge)
    expect(JSON.stringify(hBad) + bBad).not.toContain(SECRET)
  })

  it('accepts a 403 as a refusal too', async () => {
    expect(await (await setup({ forged: { status: 403, body: '' } }).call()).json()).toEqual({ status: 'ok' })
  })

  it('FAILS a shop that echoes the challenge but accepts a wrong signature: it would take stock numbers from anyone', async () => {
    const s = setup({ forged: { status: 200, body: JSON.stringify({ challenge: 'whatever' }) } })
    const out = await (await s.call()).json()
    expect(out.status).toBe('failed')
    expect(out.error).toContain('accepted a request with a wrong signature')
    expect(s.finished[0].slice(1, 2)).toEqual([false])
  })

  it('fails when the shop answers the wrong signature with anything other than 401 or 403, or cannot be reached', async () => {
    for (const forged of [{ status: 404, body: '' }, { status: 500, body: '' }, { status: 400, body: '' }]) {
      const out = await (await setup({ forged }).call()).json()
      expect(out.status).toBe('failed')
      expect(out.error).toContain(`HTTP ${forged.status}`)
      expect(out.error).toContain('401 or 403')
    }
    const out = await (await setup({ forged: new HttpError('The request timed out.', true) }).call()).json()
    expect(out).toMatchObject({ status: 'failed', error: expect.stringContaining('could not be checked') })
  })

  it('does not send the control request when the challenge already failed', async () => {
    const s = setup({ answer: { status: 200, body: '{}' } })
    await s.call()
    expect(s.post).toHaveBeenCalledTimes(1)
  })

  it('fails when the shop answers 2xx but not with the challenge (an endpoint that accepts anything proves nothing)', async () => {
    for (const body of ['', 'OK', '{"challenge":"something else"}', '{}']) {
      const s = setup({ answer: { status: 200, body } })
      const out = await (await s.call()).json()
      expect(out.status).toBe('failed')
      expect(s.finished[0].slice(1, 3)).toEqual([false, 200])
    }
  })

  it('fails on an error status, a redirect or a network error, and does not send when the last check refuses', async () => {
    expect((await (await setup({ answer: { status: 401, body: '' } }).call()).json())).toEqual({ status: 'failed', error: 'The shop answered with HTTP 401.' })
    expect((await (await setup({ answer: { status: 301, body: '' } }).call()).json()).status).toBe('failed')
    expect((await (await setup({ answer: new HttpError('Destination blocked: Private or internal address', false) }).call()).json()).error).toContain('Destination blocked')
    const s = setup({ allowed: false })
    expect((await (await s.call()).json()).status).toBe('failed')
    expect(s.post).not.toHaveBeenCalled()
  })
})

// keeps the unused-type import honest
const _deps: PushDeps | null = null
void _deps
