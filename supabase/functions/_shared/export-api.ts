import { json, parseBearer, sha256Hex } from './keys.ts'
import type { Logger } from './log.ts'
import type { IngestStore } from './store.ts'

export const EXPORT_RESOURCES = ['orders', 'customers', 'products'] as const
export type ExportResource = (typeof EXPORT_RESOURCES)[number]

/** A request older or newer than this (seconds) is refused, so a captured one cannot be used later. */
export const EXPORT_TOLERANCE_SECONDS = 300
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200
const REQUEST_ID = /^[A-Za-z0-9_-]{8,100}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

export type BeginRefusal = 'not_connected' | 'export_off' | 'rate_limited' | 'replayed'
export interface Cursor {
  at: string
  id: string
}

/** Persistence boundary for the export; implemented over the export_* SQL functions and by a fake in tests. */
export interface ExportStore {
  begin(integrationId: string, requestId: string, resource: ExportResource): Promise<{ ok: true; callId: string; secret: string } | { ok: false; reason: BeginRefusal }>
  finish(callId: string, status: 'ok' | 'refused' | 'failed', reason: string | null, rows: number): Promise<void>
  page(integrationId: string, resource: ExportResource, q: { since: string | null; after: Cursor | null; limit: number }): Promise<{ items: unknown[]; next: Cursor | null }>
}

export interface ExportDeps {
  store: Pick<IngestStore, 'findIntegrationByKeyHash' | 'touchIntegration'>
  exports: ExportStore
  log: Logger
  now?: () => Date
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** The query as both sides write it: sorted, each part percent-encoded, so the order the caller wrote it in does not matter. */
export function canonicalQuery(params: URLSearchParams): string {
  return [...params.entries()]
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
}

/** HMAC-SHA256 (hex) over "timestamp.requestId.GET.resource.canonicalQuery", keyed with the export secret. */
export async function signExport(secret: string, timestamp: string, requestId: string, resource: string, query: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${requestId}.GET.${resource}.${query}`)))
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function encodeCursor(c: Cursor): string {
  return btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCursor(text: string): Cursor | null {
  try {
    const parsed = JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof parsed?.at === 'string' && typeof parsed?.id === 'string' && ISO_TIME.test(parsed.at) && UUID.test(parsed.id)) {
      return { at: parsed.at, id: parsed.id }
    }
  } catch {
    // fall through
  }
  return null
}

/**
 * GET /export/{orders|customers|products}: a shop reads its own data back, read-only, a page at a time.
 * Locks, in this order: the shop key and X-Store-Id, a fresh signed request (X-WR-Timestamp, X-WR-Request-Id, X-WR-Signature), then
 * the database decides: export must be switched on (the owner made a secret), under the hourly cap, and the request id unused.
 */
export async function handleExport(req: Request, deps: ExportDeps): Promise<Response> {
  const respond = (status: number, body: Record<string, unknown>) => {
    const res = json(status, body)
    res.headers.set('cache-control', 'no-store')
    return res
  }
  if (req.method !== 'GET') return respond(405, { error: 'method_not_allowed' })

  const url = new URL(req.url)
  const resource = url.pathname.split('/').filter(Boolean).pop() as ExportResource | undefined
  if (!resource || !(EXPORT_RESOURCES as readonly string[]).includes(resource)) {
    return respond(404, { error: 'unknown_resource', detail: `Use one of: ${EXPORT_RESOURCES.join(', ')}.` })
  }

  const key = parseBearer(req)
  if (!key) return respond(401, { error: 'invalid_key' })
  const integration = await deps.store.findIntegrationByKeyHash(await sha256Hex(key))
  if (!integration || integration.status === 'revoked') return respond(401, { error: 'invalid_key' })
  if (integration.status !== 'connected' || !integration.externalStoreId) return respond(403, { error: 'integration_not_bound' })
  if (req.headers.get('x-store-id') !== integration.externalStoreId) return respond(403, { error: 'store_mismatch' })

  const timestamp = req.headers.get('x-wr-timestamp') ?? ''
  const requestId = req.headers.get('x-wr-request-id') ?? ''
  const signature = /^v1=([0-9a-f]{64})$/.exec(req.headers.get('x-wr-signature') ?? '')?.[1]
  if (!/^\d{10}$/.test(timestamp) || !signature) return respond(401, { error: 'signature_required' })
  if (!REQUEST_ID.test(requestId)) return respond(400, { error: 'invalid_request_id', detail: 'X-WR-Request-Id: 8 to 100 letters, digits, - or _. Use a new one for every call.' })
  const nowSeconds = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000)
  if (Math.abs(nowSeconds - Number(timestamp)) > EXPORT_TOLERANCE_SECONDS) {
    return respond(401, { error: 'stale_timestamp', detail: `X-WR-Timestamp must be within ${EXPORT_TOLERANCE_SECONDS} seconds of now (unix seconds).` })
  }

  // The query: only what the page needs. Anything else is a mistake worth telling the caller about.
  const known = new Set(['limit', 'cursor', 'updated_since'])
  for (const name of url.searchParams.keys()) {
    if (!known.has(name)) return respond(400, { error: 'invalid_query', detail: `Unknown parameter "${name}". Use limit, cursor, updated_since.` })
  }
  for (const name of known) {
    if (url.searchParams.getAll(name).length > 1) return respond(400, { error: 'invalid_query', detail: `"${name}" is given more than once.` })
  }
  const limitText = url.searchParams.get('limit')
  const limit = limitText === null ? DEFAULT_LIMIT : Number(limitText)
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return respond(400, { error: 'invalid_query', detail: `limit is a whole number from 1 to ${MAX_LIMIT}.` })
  }
  const since = url.searchParams.get('updated_since')
  if (since !== null && (!ISO_TIME.test(since) || Number.isNaN(Date.parse(since)))) {
    return respond(400, { error: 'invalid_query', detail: 'updated_since is an ISO time with a zone, like 2026-11-01T00:00:00Z.' })
  }
  const cursorText = url.searchParams.get('cursor')
  const after = cursorText === null ? null : decodeCursor(cursorText)
  if (cursorText !== null && !after) return respond(400, { error: 'invalid_cursor', detail: 'Use next_cursor exactly as the last page gave it.' })

  const begun = await deps.exports.begin(integration.id, requestId, resource)
  if (!begun.ok) {
    const answers: Record<BeginRefusal, [number, string]> = {
      not_connected: [403, 'integration_not_bound'],
      export_off: [403, 'export_off'],
      rate_limited: [429, 'rate_limited'],
      replayed: [409, 'request_id_used'],
    }
    const [status, error] = answers[begun.reason]
    const res = respond(status, {
      error,
      ...(begun.reason === 'export_off' ? { detail: 'The shop owner has not switched export on in WorkRelay.' } : {}),
      ...(begun.reason === 'replayed' ? { detail: 'Every call needs a new X-WR-Request-Id.' } : {}),
    })
    if (begun.reason === 'rate_limited') res.headers.set('retry-after', '60')
    return res
  }

  try {
    const expected = await signExport(begun.secret, timestamp, requestId, resource, canonicalQuery(url.searchParams))
    if (!sameText(expected, signature)) {
      await deps.exports.finish(begun.callId, 'refused', 'The signature did not match.', 0)
      return respond(401, { error: 'invalid_signature' })
    }
    const page = await deps.exports.page(integration.id, resource, { since, after, limit })
    await deps.exports.finish(begun.callId, 'ok', null, page.items.length)
    await deps.store.touchIntegration(integration.id).catch(() => undefined)
    return respond(200, {
      resource,
      items: page.items,
      has_more: page.next !== null,
      next_cursor: page.next ? encodeCursor(page.next) : null,
    })
  } catch (err) {
    deps.log.error('export failed', { integration_id: integration.id, resource, message: err instanceof Error ? err.message : 'unknown' })
    await deps.exports.finish(begun.callId, 'failed', 'internal error', 0).catch(() => undefined)
    return respond(500, { error: 'internal_error' })
  }
}
