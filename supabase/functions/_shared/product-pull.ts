import { describeIssues } from './ingest.ts'
import { PULL_MAX_PRODUCTS, inventoryEnvelope, toDatabaseItems } from './inventory-contract.ts'
import type { Logger } from './log.ts'

/**
 * The scheduled pull: WorkRelay asks the shop's own endpoint for its products. This is the safety net behind the push
 * webhook, and the only feed for shops that do not push. How often is the platform admin's setting (calls per days).
 * The claim moves the shop's next time forward before anything is fetched, so a slow or failing shop never exceeds
 * its budget. Reports are stamped with the moment the request was SENT, so a push that happened while the response was
 * on its way is never overwritten by it.
 */

export interface DueSync {
  integrationId: string
  sourceUrl: string
  authHeader: string | null
  /** Who started this pull: the schedule (the default) or a person pressing Sync now. Kept in the sync history. */
  trigger?: 'scheduled' | 'manual'
}

export interface PullStore {
  claimDue(limit: number): Promise<DueSync[]>
  apply(a: { integrationId: string; items: Record<string, unknown>[]; at: string; trigger?: 'scheduled' | 'manual' }): Promise<number>
  /** Saves the outcome and shows it in Event history. `count` is how many products the answer held. */
  record(integrationId: string, error: string | null, count?: number, trigger?: 'scheduled' | 'manual'): Promise<void>
}

export interface PullHttp {
  /** Throws with a readable message on blocked destinations, timeouts and network failures. Never follows redirects. */
  get(url: string, headers: Record<string, string>): Promise<{ status: number; body: string }>
}

export interface PullDeps {
  store: PullStore
  http: PullHttp
  log: Logger
  now?: () => Date
}

export async function pullDueProducts(deps: PullDeps, limit = 3): Promise<{ pulled: number; failed: number }> {
  const due = await deps.store.claimDue(limit)
  const results = await Promise.all(due.map((shop) => pullShop(shop, deps)))
  return { pulled: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length }
}

export type PullOutcome = { ok: true; products: number } | { ok: false; error: string }

/**
 * One pull from one shop: ask its URL, check the answer, apply it, and record the outcome (it shows in Event history).
 * Used by the scheduler and by "Sync now", so a manual sync is exactly the same operation as a scheduled one.
 */
export async function pullShop(shop: DueSync, deps: PullDeps): Promise<PullOutcome> {
  const sentAt = (deps.now ?? (() => new Date()))().toISOString()
  const fail = async (raw: string): Promise<PullOutcome> => {
    // Whatever went wrong, the shop's saved Authorization value must never end up in a message that is stored or shown.
    const message = shop.authHeader && shop.authHeader.length >= 4 ? raw.split(shop.authHeader).join('[hidden]') : raw
    deps.log.info('product pull failed', { integration_id: shop.integrationId, reason: message })
    await deps.store.record(shop.integrationId, message, undefined, shop.trigger).catch(() => undefined)
    return { ok: false, error: message }
  }
  try {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (shop.authHeader) headers.authorization = shop.authHeader
    const res = await deps.http.get(shop.sourceUrl, headers)
    if (res.status < 200 || res.status >= 300) return await fail(`The shop answered with HTTP ${res.status}`)

    let value: unknown
    try {
      value = JSON.parse(res.body)
    } catch {
      return await fail('The response was not valid JSON')
    }
    // Both { "products": [...] } and a bare list are accepted.
    const parsed = inventoryEnvelope(PULL_MAX_PRODUCTS).safeParse(Array.isArray(value) ? { products: value } : value)
    if (!parsed.success) return await fail(`Unexpected response: ${describeIssues(parsed.error)}`.slice(0, 500))

    const applied = await deps.store.apply({ integrationId: shop.integrationId, items: toDatabaseItems(parsed.data.products), at: sentAt, trigger: shop.trigger })
    await deps.store.record(shop.integrationId, null, applied)
    return { ok: true, products: applied }
  } catch (err) {
    return await fail(err instanceof Error ? err.message : 'The request failed')
  }
}
