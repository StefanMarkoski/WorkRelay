import { z } from 'zod'
import type { Caller } from './auth.ts'
import { HttpError } from './engine.ts'
import { describeIssues } from './ingest.ts'
import { json } from './keys.ts'
import type { DueSync, PullOutcome } from './product-pull.ts'
import type { Logger } from './log.ts'

/**
 * Stock write-back: WorkRelay tells a shop its stock number. Everything that decides WHETHER to send lives in the database
 * (claim_stock_pushes, stock_push_still_allowed); this file only builds the signed request, sends it under strict network rules
 * and reports what happened. What leaves WorkRelay is the SKU, the new absolute number and a sequence: no names, emails or prices.
 *
 * Signature (documented for shops in shop-webhook-integration.md):
 *   X-WorkRelay-Timestamp   unix seconds
 *   X-WorkRelay-Request-Id  a UUID, new for every request (a retry of the same numbers gets a new one)
 *   X-WorkRelay-Signature   v1=<hex HMAC-SHA256 of  `${timestamp}.${requestId}.${rawBody}`  with the shop's signing secret>
 */

export interface PushItem {
  sku: string
  stock: number
  seq: number
  as_of: string
  /** What WorkRelay last read from the shop for this SKU, and when: lets the shop see if its own number has moved since. */
  reported_stock: number | null
  reported_at: string | null
}

export interface ClaimedPush {
  requestId: string
  integrationId: string
  storeId: string | null
  url: string
  secret: string
  items: PushItem[]
}

export interface TestClaim {
  requestId: string
  storeId: string | null
  url: string
  secret: string
  challenge: string
}

export interface PushStore {
  /** The shops to read before (or after) sending: the database decides which, and how often. */
  claimPulls(): Promise<DueSync[]>
  failPull(integrationId: string, message: string): Promise<void>
  claim(): Promise<ClaimedPush[]>
  stillAllowed(requestId: string): Promise<boolean>
  complete(requestId: string, ok: boolean, httpStatus: number | null, error: string | null): Promise<void>
  /** Throws an Error whose message is one of TEST_REFUSALS' keys (or 'forbidden'). */
  beginTest(userId: string, integrationId: string): Promise<TestClaim>
  finishTest(requestId: string, ok: boolean, httpStatus: number | null, error: string | null): Promise<void>
}

export interface PushHttp {
  /** Throws with a readable message on blocked destinations, timeouts and network failures. Never follows redirects. */
  post(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }>
}

export interface PushDeps {
  store: PushStore
  http: PushHttp
  log: Logger
  now?: () => Date
  /** Reads the shop's own numbers (the same operation as the scheduled pull, but quiet: no announcement). */
  pull?: (shop: DueSync) => Promise<PullOutcome>
}

export async function signStockPush(secret: string, timestamp: string, requestId: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${requestId}.${rawBody}`))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface Prepared {
  headers: Record<string, string>
  body: string
}

export async function prepare(secret: string, requestId: string, payload: Record<string, unknown>, now: Date): Promise<Prepared> {
  const body = JSON.stringify(payload)
  const timestamp = String(Math.floor(now.getTime() / 1000))
  return {
    body,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'WorkRelay-StockPush/1',
      'x-workrelay-request-id': requestId,
      'x-workrelay-timestamp': timestamp,
      'x-workrelay-signature': `v1=${await signStockPush(secret, timestamp, requestId, body)}`,
    },
  }
}

/** A fixed set of readable reasons: nothing the shop wrote is ever stored or shown. */
function failureReason(err: unknown): string {
  if (err instanceof HttpError) return err.message
  const m = err instanceof Error ? err.message : ''
  if (m === 'The request timed out') return 'The request timed out.'
  if (m.startsWith('The shop redirected')) return 'The shop redirected the request; redirects are not followed.'
  return 'The request failed.'
}

type Outcome = { ok: true; status: number; body: string } | { ok: false; status: number | null; error: string }

async function send(deps: PushDeps, url: string, prepared: Prepared): Promise<Outcome> {
  try {
    const res = await deps.http.post(url, prepared.headers, prepared.body)
    if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, error: 'The shop redirected the request; redirects are not followed.' }
    if (res.status < 200 || res.status >= 300) return { ok: false, status: res.status, error: `The shop answered with HTTP ${res.status}.` }
    return { ok: true, status: res.status, body: res.body }
  } catch (err) {
    return { ok: false, status: null, error: failureReason(err) }
  }
}

/**
 * The engine's part, like git: read the shop's own numbers first (and once more after a push, to check it took them), then send what
 * the database says may be sent, and report each outcome. A shop that cannot be read is not sent anything.
 */
export async function pushPendingStock(deps: PushDeps): Promise<{ pulled: number; pull_failed: number; sent: number; failed: number; cancelled: number }> {
  const totals = { pulled: 0, pull_failed: 0, sent: 0, failed: 0, cancelled: 0 }
  if (deps.pull) {
    const pull = deps.pull
    const toRead = await deps.store.claimPulls()
    await Promise.all(
      toRead.map(async (shop) => {
        const out = await pull(shop).catch((err): PullOutcome => ({ ok: false, error: err instanceof Error ? err.message : 'The request failed' }))
        if (out.ok) {
          totals.pulled++
          return
        }
        totals.pull_failed++
        await deps.store.failPull(shop.integrationId, out.error).catch((err) => {
          deps.log.error('stock pull failure not recorded', { integration_id: shop.integrationId, message: err instanceof Error ? err.message : 'unknown' })
        })
      }),
    )
  }
  const claimed = await deps.store.claim()
  await Promise.all(
    claimed.map(async (c) => {
      try {
        // the last look: switched off, locked, or changed since the claim means this request never leaves
        if (!(await deps.store.stillAllowed(c.requestId))) {
          totals.cancelled++
          return
        }
        const prepared = await prepare(
          c.secret,
          c.requestId,
          { type: 'stock.update', request_id: c.requestId, sent_at: (deps.now?.() ?? new Date()).toISOString(), store_id: c.storeId, items: c.items },
          deps.now?.() ?? new Date(),
        )
        const out = await send(deps, c.url, prepared)
        await deps.store.complete(c.requestId, out.ok, out.status, out.ok ? null : out.error)
        if (out.ok) totals.sent++
        else totals.failed++
      } catch (err) {
        totals.failed++
        deps.log.error('stock push failed', { integration_id: c.integrationId, message: err instanceof Error ? err.message : 'unknown' })
        await deps.store.complete(c.requestId, false, null, 'The request failed.').catch(() => {})
      }
    }),
  )
  return totals
}

// ------------------------------------------------------------------------------------------------ the owner's test

const bodySchema = z.object({ integration_id: z.uuid() })

/**
 * The control: the same kind of request with a wrong signature. A shop that checks signatures refuses it (401 or 403); a shop that only
 * echoes the challenge would accept it, and then anyone who learns the address could set the shop's stock. Nothing real is in the body.
 */
async function forgedRequestIsRefused(deps: TestDeps, t: TestClaim, now: Date): Promise<string | null> {
  const requestId = crypto.randomUUID()
  const prepared = await prepare(t.secret, requestId, { type: 'stock.test', request_id: requestId, sent_at: now.toISOString(), store_id: t.storeId, challenge: `forged-${requestId}` }, now)
  prepared.headers['x-workrelay-signature'] = `v1=${'0'.repeat(64)}`
  const out = await send(deps, t.url, prepared)
  if (!out.ok && (out.status === 401 || out.status === 403)) return null
  if (out.ok) return 'The shop accepted a request with a wrong signature. Check the X-WorkRelay-Signature of every request and answer 401 or 403 when it does not match.'
  if (out.status !== null) return `The shop answered a request with a wrong signature with HTTP ${out.status}. It must refuse it with 401 or 403.`
  return `A request with a wrong signature could not be checked: ${out.error}`
}

/** What each refusal means, in words an owner can act on. The app shows these. */
export const TEST_REFUSALS: Record<string, string> = {
  no_url: 'Add the shop\'s stock address first.',
  no_secret: 'Create a signing secret first.',
  too_soon: 'A test was just sent. Give it ten seconds.',
  not_connected: 'This shop is not connected.',
  locked: 'WorkRelay has blocked stock write-back for this shop.',
}

export interface TestDeps extends PushDeps {
  getCaller(req: Request): Promise<Caller>
}

/**
 * POST /stock-push-test { integration_id }: send the shop one signed request carrying a random challenge. The shop passes only
 * if it answers 2xx with JSON {"challenge": "<the same value>"}, which proves it can verify our signature path and is the
 * endpoint the owner meant. Only the owner of the shop's workspace may ask; the database decides that.
 */
export async function handleStockPushTest(req: Request, deps: TestDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const caller = await deps.getCaller(req)
  if (!caller.ok) return json(401, { error: 'unauthenticated' })
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json(400, { error: 'invalid_payload', detail: describeIssues(parsed.error) })

  let t: TestClaim
  try {
    t = await deps.store.beginTest(caller.id, parsed.data.integration_id)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    if (code === 'forbidden') return json(403, { error: 'forbidden' })
    if (code in TEST_REFUSALS) return json(409, { error: code, detail: TEST_REFUSALS[code] })
    deps.log.error('stock push test claim failed', { integration_id: parsed.data.integration_id, message: code })
    return json(500, { error: 'internal_error' })
  }

  if (!(await deps.store.stillAllowed(t.requestId))) {
    return json(200, { status: 'failed', error: 'Not sent: the address or the secret changed. Try again.' })
  }
  const now = deps.now?.() ?? new Date()
  const prepared = await prepare(t.secret, t.requestId, { type: 'stock.test', request_id: t.requestId, sent_at: now.toISOString(), store_id: t.storeId, challenge: t.challenge }, now)
  const out = await send(deps, t.url, prepared)
  let error: string | null = out.ok ? null : out.error
  if (out.ok) {
    let echoed: unknown = null
    try {
      echoed = (JSON.parse(out.body) as { challenge?: unknown }).challenge
    } catch {
      // not JSON
    }
    if (echoed !== t.challenge) error = 'The shop answered, but did not send the challenge back. Answer a stock.test request with {"challenge": "<the same value>"}.'
  }
  if (out.ok && error === null) error = await forgedRequestIsRefused(deps, t, now)
  await deps.store.finishTest(t.requestId, error === null, out.status, error)
  return json(200, error === null ? { status: 'ok' } : { status: 'failed', error })
}
