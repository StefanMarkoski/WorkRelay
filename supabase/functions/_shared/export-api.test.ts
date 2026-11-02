import { beforeEach, describe, expect, it } from 'vitest'
import { canonicalQuery, decodeCursor, encodeCursor, handleExport, signExport, type BeginRefusal, type Cursor, type ExportStore } from './export-api.ts'
import type { Logger } from './log.ts'
import { MemoryStore } from './memory-store.ts'

const KEY = `wr_live_${'f'.repeat(64)}`
const SECRET = `wr_export_${'a'.repeat(64)}`
const NOW = new Date('2026-11-02T12:00:00Z')
const TS = String(Math.floor(NOW.getTime() / 1000))
const log: Logger = { info() {}, error() {} }

/** Mirrors export_begin / export_finish / export_page closely enough for the handler's rules. */
class FakeExports implements ExportStore {
  secret: string | null = SECRET
  used = new Set<string>()
  calls: { id: string; status: string; reason: string | null; rows: number }[] = []
  refuse: BeginRefusal | null = null
  fail = false
  lastPage: { since: string | null; after: Cursor | null; limit: number } | null = null
  items: unknown[] = [{ id: 'one' }, { id: 'two' }]
  next: Cursor | null = null

  async begin(_integrationId: string, requestId: string) {
    if (this.refuse) return { ok: false as const, reason: this.refuse }
    if (!this.secret) return { ok: false as const, reason: 'export_off' as const }
    if (this.used.has(requestId)) return { ok: false as const, reason: 'replayed' as const }
    this.used.add(requestId)
    const id = `call_${this.calls.length + 1}`
    this.calls.push({ id, status: 'started', reason: null, rows: 0 })
    return { ok: true as const, callId: id, secret: this.secret }
  }
  async finish(callId: string, status: 'ok' | 'refused' | 'failed', reason: string | null, rows: number) {
    Object.assign(this.calls.find((c) => c.id === callId)!, { status, reason, rows })
  }
  refusals: string[] = []
  async refused(_i: string, _r: string, reason: string) {
    this.refusals.push(reason)
  }
  async page(_i: string, _r: string, q: { since: string | null; after: Cursor | null; limit: number }) {
    if (this.fail) throw new Error('database down')
    this.lastPage = q
    return { items: this.items, next: this.next }
  }
}

let store: MemoryStore
let exports: FakeExports
let n = 0

const signed = async (path: string, init: { key?: string; headers?: Record<string, string>; ts?: string; id?: string; secret?: string } = {}) => {
  const url = new URL(`https://x.test/export/${path}`)
  const id = init.id ?? `request-${++n}-abcdefgh`
  const ts = init.ts ?? TS
  const resource = url.pathname.split('/').pop()!
  const sig = await signExport(init.secret ?? SECRET, ts, id, resource, canonicalQuery(url.searchParams))
  return new Request(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${init.key ?? KEY}`,
      'x-store-id': 'shop-1',
      'x-wr-timestamp': ts,
      'x-wr-request-id': id,
      'x-wr-signature': `v1=${sig}`,
      ...init.headers,
    },
  })
}
const call = (req: Request) => handleExport(req, { store, exports, log, now: () => NOW })

beforeEach(async () => {
  store = new MemoryStore()
  await store.addIntegration(KEY, { status: 'connected', externalStoreId: 'shop-1' })
  exports = new FakeExports()
})

describe('a good call', () => {
  it('returns the page, never caches it, and records the call', async () => {
    const res = await call(await signed('orders'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ resource: 'orders', items: [{ id: 'one' }, { id: 'two' }], has_more: false, next_cursor: null })
    expect(exports.calls).toEqual([{ id: 'call_1', status: 'ok', reason: null, rows: 2 }])
    expect(exports.lastPage).toEqual({ since: null, after: null, limit: 100 })
  })

  it('works for customers and products too', async () => {
    expect((await call(await signed('customers'))).status).toBe(200)
    expect((await call(await signed('products'))).status).toBe(200)
  })

  it('hands on the next page as an opaque cursor that comes back unchanged', async () => {
    exports.next = { at: '2026-10-02T10:00:00.5+00:00', id: 'a3000000-0000-0000-0000-0000000000e2' }
    const body = await (await call(await signed('orders?limit=2'))).json()
    expect(body.has_more).toBe(true)
    await call(await signed(`orders?limit=2&cursor=${body.next_cursor}`))
    expect(exports.lastPage).toEqual({ since: null, after: exports.next, limit: 2 })
  })

  it('signs the query in any order the caller wrote it', async () => {
    const url = 'https://x.test/export/orders?updated_since=2026-11-01T00%3A00%3A00Z&limit=5'
    const sig = await signExport(SECRET, TS, 'request-order-xx', 'orders', canonicalQuery(new URL(url).searchParams))
    const req = new Request(url, {
      headers: { authorization: `Bearer ${KEY}`, 'x-store-id': 'shop-1', 'x-wr-timestamp': TS, 'x-wr-request-id': 'request-order-xx', 'x-wr-signature': `v1=${sig}` },
    })
    expect((await call(req)).status).toBe(200)
    expect(exports.lastPage).toEqual({ since: '2026-11-01T00:00:00Z', after: null, limit: 5 })
  })
})

describe('the shop key and the store', () => {
  it('refuses a missing, unknown or revoked key', async () => {
    expect((await call(await signed('orders', { headers: { authorization: '' } }))).status).toBe(401)
    expect((await call(await signed('orders', { key: `wr_live_${'1'.repeat(64)}` }))).status).toBe(401)
    for (const i of store.integrations.values()) i.status = 'revoked'
    expect((await call(await signed('orders'))).status).toBe(401)
    expect(exports.calls).toHaveLength(0)
  })

  it('refuses the wrong store, a shop that is not bound, other methods and unknown resources', async () => {
    expect((await call(await signed('orders', { headers: { 'x-store-id': 'someone-else' } }))).status).toBe(403)
    expect((await call(await signed('secrets'))).status).toBe(404)
    expect((await call(new Request('https://x.test/export/orders', { method: 'POST' }))).status).toBe(405)
    for (const i of store.integrations.values()) i.status = 'awaiting_bind'
    expect((await call(await signed('orders'))).status).toBe(403)
    expect(exports.calls).toHaveLength(0)
  })
})

describe('the signature', () => {
  it('needs all three headers', async () => {
    for (const h of ['x-wr-signature', 'x-wr-timestamp']) {
      const res = await call(await signed('orders', { headers: { [h]: '' } }))
      expect(res.status).toBe(401)
    }
    expect((await call(await signed('orders', { headers: { 'x-wr-request-id': 'short' } }))).status).toBe(400)
  })

  it('refuses a signature made with another secret, and records the refusal', async () => {
    const res = await call(await signed('orders', { secret: `wr_export_${'b'.repeat(64)}` }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_signature')
    expect(exports.calls).toEqual([{ id: 'call_1', status: 'refused', reason: 'The signature did not match.', rows: 0 }])
    expect(exports.lastPage).toBeNull()
  })

  it('refuses a signature that covers a different query than the one sent', async () => {
    const req = await signed('orders?limit=5')
    const tampered = new Request(req.url.replace('limit=5', 'limit=200'), { headers: req.headers })
    expect((await call(tampered)).status).toBe(401)
    const second = await signed('orders?limit=5')
    const otherResource = new Request(second.url.replace('/orders', '/customers'), { headers: second.headers })
    expect((await call(otherResource)).status).toBe(401)
    expect(exports.lastPage).toBeNull()
  })

  it('refuses a request that is too old or from the future', async () => {
    expect((await call(await signed('orders', { ts: String(Number(TS) - 301) }))).status).toBe(401)
    expect((await call(await signed('orders', { ts: String(Number(TS) + 301) }))).status).toBe(401)
    expect((await call(await signed('orders', { ts: String(Number(TS) - 299) }))).status).toBe(200)
  })

  it('uses a request id once: sending the same signed request again is refused', async () => {
    const req = await signed('orders', { id: 'once-only-1234' })
    expect((await call(req.clone())).status).toBe(200)
    const again = await call(req.clone())
    expect(again.status).toBe(409)
    expect((await again.json()).error).toBe('request_id_used')
  })
})

describe('the owner and the limits', () => {
  it('says export is off when the owner made no secret, and gives nothing', async () => {
    exports.secret = null
    const res = await call(await signed('orders'))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('export_off')
    expect(exports.lastPage).toBeNull()
  })

  it('answers 429 with a retry hint when the hourly cap is reached', async () => {
    exports.refuse = 'rate_limited'
    const res = await call(await signed('orders'))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
  })

  it('does not leak internals when the database fails, and records the failure', async () => {
    exports.fail = true
    const res = await call(await signed('orders'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal_error' })
    expect(exports.calls[0]).toMatchObject({ status: 'failed', reason: 'internal error' })
  })
})

describe('the query', () => {
  it.each([
    ['orders?limit=0'],
    ['orders?limit=201'],
    ['orders?limit=abc'],
    ['orders?limit=1.5'],
    ['orders?limit=5&limit=6'],
    ['orders?updated_since=yesterday'],
    ['orders?updated_since=2026-11-01'],
    ['orders?sort=desc'],
  ])('refuses %s before anything is read', async (path) => {
    const res = await call(await signed(path))
    expect(res.status).toBe(400)
    expect(exports.calls).toHaveLength(0)
  })

  it('refuses a cursor it did not hand out', async () => {
    for (const bad of ['nonsense', encodeCursor({ at: "x'; drop table orders;--", id: 'a3000000-0000-0000-0000-0000000000e2' }), encodeCursor({ at: '2026-10-02T10:00:00Z', id: 'not-a-uuid' })]) {
      const res = await call(await signed(`orders?cursor=${bad}`))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('invalid_cursor')
    }
  })

  it('round-trips a cursor', () => {
    const c = { at: '2026-10-02T10:00:00.123456+00:00', id: 'a3000000-0000-0000-0000-0000000000e2' }
    expect(decodeCursor(encodeCursor(c))).toEqual(c)
  })
})

describe('refusals are written to the history', () => {
  it('records each refusal that comes after a real shop key', async () => {
    await call(await signed('orders', { headers: { 'x-store-id': 'someone-else' } }))
    await call(await signed('orders', { headers: { 'x-wr-signature': '' } }))
    await call(await signed('orders', { ts: String(Number(TS) - 999) }))
    await call(await signed('orders', { headers: { 'x-wr-request-id': 'short' } }))
    await call(await signed('orders?limit=0'))
    await call(await signed('orders?cursor=nonsense'))
    const reuse = await signed('orders', { id: 'reused-12345678' })
    await call(reuse.clone())
    await call(reuse.clone())
    exports.secret = null
    await call(await signed('orders'))
    expect(exports.refusals).toEqual([
      'The X-Store-Id did not match this shop.',
      'No signature or timestamp was sent.',
      'The timestamp was too far from the current time.',
      'The request id was missing or malformed.',
      'The limit was not a number from 1 to 200.',
      'The cursor was not one WorkRelay handed out.',
      'The request id had been used before.',
      'Export is switched off for this shop.',
    ])
  })

  it('records nothing for a caller without a real shop key, and a refusal log failure never changes the answer', async () => {
    await call(await signed('orders', { key: `wr_live_${'1'.repeat(64)}` }))
    await call(await signed('secrets'))
    expect(exports.refusals).toEqual([])
    exports.refused = async () => { throw new Error('history down') }
    expect((await call(await signed('orders?limit=0'))).status).toBe(400)
  })
})
