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

  // Every push is shown in Event history, as a short summary (never the whole feed). Best effort: it must not fail a push.
  const note = async (status: 'processed' | 'ignored' | 'failed', payload: Record<string, unknown>, error?: string) => {
    try {
      const recorded = await deps.store.recordEvent({
        organizationId: integration.organizationId,
        integrationId: integration.id,
        eventId: `inventory:push:${crypto.randomUUID()}`,
        eventType: 'inventory.push',
        rawPayload: payload,
      })
      await deps.store.markEvent(recorded.id, status, error)
    } catch {
      // history is a convenience
    }
  }

  const body = await readJsonBody(req)
  if (!body.ok) {
    await note('failed', { rejected: true }, body.error)
    return json(400, { error: 'invalid_payload', detail: body.error })
  }

  const parsed = inventoryEnvelope(PUSH_MAX_PRODUCTS).safeParse(body.value)
  if (!parsed.success) {
    const detail = describeIssues(parsed.error)
    await note('failed', { rejected: true }, detail)
    return json(400, { error: 'invalid_payload', detail })
  }

  const summary = { products: parsed.data.products.length, skus: parsed.data.products.slice(0, 10).map((p) => p.sku) }
  try {
    const result = await deps.store.applyProducts({
      integrationId: integration.id,
      items: toDatabaseItems(parsed.data.products),
      source: 'push',
      at: new Date().toISOString(),
    })
    if (result === 'disabled') {
      await note('ignored', summary, 'inventory_push_disabled: pushing is switched off for this shop (Settings, API Calls)')
      return json(202, { status: 'ignored', reason: 'inventory_push_disabled' })
    }
    await deps.store.touchIntegration(integration.id).catch(() => undefined) // last-seen is best effort
    await note('processed', summary)
    return json(200, { status: 'processed', applied: result })
  } catch (err) {
    await note('failed', summary, 'internal error')
    deps.log.error('inventory webhook processing failed', {
      integration_id: integration.id,
      message: err instanceof Error ? err.message : 'unknown',
    })
    return json(500, { error: 'internal_error' })
  }
}
