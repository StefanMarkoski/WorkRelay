import { z } from 'zod'
import type { Caller } from './auth.ts'
import { describeIssues } from './ingest.ts'
import { json } from './keys.ts'
import { pullShop, type PullDeps } from './product-pull.ts'

/**
 * POST /sync-now { integration_id }: pull one shop's products right now. It is the scheduled pull, started by a person, so it
 * obeys the same rules: the platform admin must have set a schedule for the shop, the workspace must have entered the URL, the
 * shop must not be paused, and the call is taken from the same budget as the scheduled ones. Only owners and admins of the
 * shop's workspace may ask; the database decides that (and everything else) in one place, claim_manual_product_sync.
 */

const bodySchema = z.object({ integration_id: z.uuid() })

export interface ClaimedCall {
  sourceUrl: string
  authHeader: string | null
  callsLeft: number
}

export interface SyncNowDeps {
  getCaller(req: Request): Promise<Caller>
  /** Takes one call from the shop's budget. Throws an Error whose message is one of the codes below. */
  claim(userId: string, integrationId: string): Promise<ClaimedCall>
  pull: PullDeps
}

/** What each refusal means, in words a shop owner can act on. The app shows these. */
export const REFUSALS: Record<string, string> = {
  not_scheduled: 'WorkRelay has not set up scheduled checks for this shop yet, so Sync now is not available. Ask WorkRelay to set them up.',
  no_url: 'This shop has no products URL yet. Add one under Settings → API Calls → Inventory.',
  paused: 'Checks for this shop are paused. Turn the pause off under Settings → API Calls → Inventory.',
  budget_used: 'This shop has used all its calls for now. They renew automatically.',
  too_soon: 'A check just started. Give it a minute.',
  not_connected: 'This shop is not connected.',
}

export async function handleSyncNow(req: Request, deps: SyncNowDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const caller = await deps.getCaller(req)
  if (!caller.ok) return json(401, { error: 'unauthenticated' })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json(400, { error: 'invalid_payload', detail: describeIssues(parsed.error) })
  const integrationId = parsed.data.integration_id

  let claimed: ClaimedCall
  try {
    claimed = await deps.claim(caller.id, integrationId)
  } catch (err) {
    const code = err instanceof Error ? err.message : ''
    if (code === 'forbidden') return json(403, { error: 'forbidden' })
    if (code in REFUSALS) return json(409, { error: code, detail: REFUSALS[code] })
    deps.pull.log.error('sync now claim failed', { integration_id: integrationId, message: code })
    return json(500, { error: 'internal_error' })
  }

  // The call is spent whatever the shop answers, exactly like a scheduled one. The outcome (and any error) is also recorded
  // for Event history by pullShop. The Authorization value never leaves this function.
  const outcome = await pullShop({ integrationId, sourceUrl: claimed.sourceUrl, authHeader: claimed.authHeader }, deps.pull)
  return outcome.ok
    ? json(200, { status: 'ok', products: outcome.products, calls_left: claimed.callsLeft })
    : json(200, { status: 'failed', error: outcome.error, calls_left: claimed.callsLeft })
}
