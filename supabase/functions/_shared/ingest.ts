import { z } from 'zod'
import { json, parseBearer, sha256Hex } from './keys.ts'
import type { Logger } from './log.ts'
import { planOrderUpdate } from './normalize.ts'
import { ORDER_EVENT_TYPES, orderWebhookSchema } from './order-contract.ts'
import type { StoredOrder } from './normalize.ts'
import type { IngestStore, IntegrationRef } from './store.ts'

export interface HandlerDeps {
  store: IngestStore
  log: Logger
}

const MAX_BODY_BYTES = 1_000_000
const MAX_APPLY_ATTEMPTS = 4

/** Resolve the integration from the bearer key. Org and store come from the key, never the payload. */
export async function authenticate(req: Request, deps: HandlerDeps): Promise<IntegrationRef | Response> {
  const key = parseBearer(req)
  if (!key) return json(401, { error: 'invalid_key' })
  const integration = await deps.store.findIntegrationByKeyHash(await sha256Hex(key))
  if (!integration || integration.status === 'revoked') return json(401, { error: 'invalid_key' })
  return integration
}

export async function readJsonBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return { ok: false, error: 'payload_too_large' }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false, error: 'malformed_json' }
  }
}

export function describeIssues(error: z.ZodError): string {
  // Paths and messages only: never echo submitted values (may contain PII).
  return error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

export async function handleOrderWebhook(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const auth = await authenticate(req, deps)
  if (auth instanceof Response) return auth
  const integration = auth
  if (integration.status !== 'connected' || !integration.externalStoreId) {
    return json(403, { error: 'integration_not_bound' })
  }
  if (req.headers.get('x-store-id') !== integration.externalStoreId) {
    return json(403, { error: 'store_mismatch' })
  }

  const ctx = { integration_id: integration.id }

  const body = await readJsonBody(req)
  const loose = body.ok
    ? z.object({ event_id: z.string().min(1).max(200), event_type: z.string().max(100).optional() }).safeParse(body.value)
    : null

  const eventId = loose?.success ? loose.data.event_id : `invalid:${crypto.randomUUID()}`
  const eventType = loose?.success ? (loose.data.event_type ?? null) : null

  // These three do not depend on each other, so they run together (one round trip instead of three).
  // The order read is only a head start: the final write checks the order's version and we re-read on a conflict.
  const rawOrderId = body.ok ? (body.value as { order?: { external_id?: unknown } } | null)?.order?.external_id : undefined
  const prefetchId = typeof rawOrderId === 'string' && rawOrderId.length > 0 && rawOrderId.length <= 200 ? rawOrderId : null
  const [recorded, prefetched] = await Promise.all([
    deps.store.recordEvent({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      eventId,
      eventType,
      rawPayload: body.ok ? body.value : { unparseable: true },
    }),
    prefetchId ? deps.store.getOrder(integration.id, prefetchId).catch(() => undefined) : Promise.resolve(undefined),
    deps.store.touchIntegration(integration.id).catch(() => undefined), // last-seen is best effort
  ])

  if (!recorded.isNew && (recorded.status === 'processed' || recorded.status === 'ignored')) {
    return json(200, { status: 'duplicate' })
  }

  if (!body.ok || !loose?.success) {
    const error = !body.ok ? body.error : `invalid_envelope: ${loose && !loose.success ? describeIssues(loose.error) : 'unknown'}`
    await deps.store.markEvent(recorded.id, 'failed', error)
    deps.log.info('webhook rejected', { ...ctx, reason: error })
    return json(400, { error: 'invalid_payload', detail: error })
  }

  if (!ORDER_EVENT_TYPES.includes(eventType as (typeof ORDER_EVENT_TYPES)[number])) {
    await deps.store.markEvent(recorded.id, 'ignored', `unsupported event_type: ${eventType}`)
    return json(202, { status: 'ignored' })
  }

  const parsed = orderWebhookSchema.safeParse(body.value)
  if (!parsed.success) {
    const error = describeIssues(parsed.error)
    await deps.store.markEvent(recorded.id, 'failed', error)
    deps.log.info('webhook validation failed', { ...ctx, reason: error })
    return json(400, { error: 'invalid_payload', detail: error })
  }

  try {
    const ev = parsed.data
    // undefined = not prefetched (or a different id): read it. null = prefetched and the order does not exist yet.
    let head: StoredOrder | null | undefined = ev.order.external_id === prefetchId ? prefetched : undefined
    for (let attempt = 0; attempt < MAX_APPLY_ATTEMPTS; attempt++) {
      const existing = head !== undefined ? head : await deps.store.getOrder(integration.id, ev.order.external_id)
      head = undefined // after the first attempt always re-read
      const plan = planOrderUpdate(existing, ev)
      const result = await deps.store.applyPlan({
        eventRowId: recorded.id,
        organizationId: integration.organizationId,
        integrationId: integration.id,
        externalId: ev.order.external_id,
        plan,
      })
      if (result === 'ok') return json(200, { status: 'processed' })
    }
    await deps.store.markEvent(recorded.id, 'failed', 'concurrent update conflict')
    return json(503, { error: 'conflict_retry' })
  } catch (err) {
    deps.log.error('webhook processing failed', { ...ctx, message: err instanceof Error ? err.message : 'unknown' })
    await deps.store.markEvent(recorded.id, 'failed', 'internal error').catch(() => {})
    return json(500, { error: 'internal_error' })
  }
}

const bindSchema = z.object({
  store_id: z.string().min(1).max(200),
  base_url: z.url({ protocol: /^https$/ }).max(500).optional(),
})

/** Handshake: the commerce app presents the WorkRelay key plus its store identity; the key is then locked to that store. */
export async function handleBind(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  const auth = await authenticate(req, deps)
  if (auth instanceof Response) return auth
  const integration = auth

  const body = await readJsonBody(req)
  const parsed = body.ok ? bindSchema.safeParse(body.value) : null
  if (!parsed?.success) return json(400, { error: 'invalid_payload', detail: body.ok ? describeIssues(parsed!.error) : body.error })
  const { store_id, base_url } = parsed.data

  if (integration.status === 'connected') {
    return integration.externalStoreId === store_id
      ? json(200, { status: 'already_bound' })
      : json(403, { error: 'bound_to_another_store' })
  }

  const result = await deps.store.bindIntegration(integration.id, store_id, base_url ?? null)
  if (result === 'bound') {
    deps.log.info('integration bound', { integration_id: integration.id })
    return json(200, { status: 'bound' })
  }
  if (result === 'store_in_use') return json(409, { error: 'store_already_connected' })
  return json(409, { error: 'not_awaiting_bind' })
}
