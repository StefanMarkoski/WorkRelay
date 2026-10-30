import { describeIssues, authenticate, readJsonBody, type HandlerDeps } from './ingest.ts'
import { PUSH_MAX_PRODUCTS, inventoryEnvelope, toDatabaseItems } from './inventory-contract.ts'
import { json } from './keys.ts'

/**
 * POST /inventory-webhook: the shop pushes product and stock updates as they happen. Same key and X-Store-Id as the
 * other webhooks. Reports are idempotent (the same report twice changes nothing) and carry a time, so an older one
 * never overwrites a newer one, whichever way it arrived. Only shops that switched pushing on are accepted.
 */
export async function handleInventoryWebhook(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const auth = await authenticate(req, deps)
  if (auth instanceof Response) return auth
  const integration = auth
  if (integration.status !== 'connected' || !integration.externalStoreId) return json(403, { error: 'integration_not_bound' })
  if (req.headers.get('x-store-id') !== integration.externalStoreId) return json(403, { error: 'store_mismatch' })

  const body = await readJsonBody(req)
  if (!body.ok) return json(400, { error: 'invalid_payload', detail: body.error })

  const parsed = inventoryEnvelope(PUSH_MAX_PRODUCTS).safeParse(body.value)
  if (!parsed.success) return json(400, { error: 'invalid_payload', detail: describeIssues(parsed.error) })

  try {
    const result = await deps.store.applyProducts({
      integrationId: integration.id,
      items: toDatabaseItems(parsed.data.products),
      source: 'push',
      at: new Date().toISOString(),
    })
    if (result === 'disabled') return json(202, { status: 'ignored', reason: 'inventory_push_disabled' })
    await deps.store.touchIntegration(integration.id).catch(() => undefined) // last-seen is best effort
    return json(200, { status: 'processed', applied: result })
  } catch (err) {
    deps.log.error('inventory webhook processing failed', {
      integration_id: integration.id,
      message: err instanceof Error ? err.message : 'unknown',
    })
    return json(500, { error: 'internal_error' })
  }
}
