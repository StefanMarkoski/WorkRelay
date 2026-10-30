import { z } from 'zod'
import { CUSTOMER_EVENT_TYPES, customerWebhookSchema, type CustomerEventType } from './customer-contract.ts'
import { authenticate, describeIssues, readJsonBody, type HandlerDeps } from './ingest.ts'
import { json } from './keys.ts'

/**
 * POST /customer-webhook: the optional signup feed. Same key, same X-Store-Id and same duplicate protection as the
 * order webhook. It only does anything for shops that switched "customer signups" on; for the others the event is
 * kept and shown as ignored (and processed if the shop resends it after switching on).
 */
export async function handleCustomerWebhook(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const auth = await authenticate(req, deps)
  if (auth instanceof Response) return auth
  const integration = auth
  if (integration.status !== 'connected' || !integration.externalStoreId) return json(403, { error: 'integration_not_bound' })
  if (req.headers.get('x-store-id') !== integration.externalStoreId) return json(403, { error: 'store_mismatch' })

  const ctx = { integration_id: integration.id }
  const body = await readJsonBody(req)
  const loose = body.ok
    ? z.object({ event_id: z.string().min(1).max(200), event_type: z.string().max(100).optional() }).safeParse(body.value)
    : null
  const eventId = loose?.success ? loose.data.event_id : `invalid:${crypto.randomUUID()}`
  const eventType = loose?.success ? (loose.data.event_type ?? null) : null

  const [recorded] = await Promise.all([
    deps.store.recordEvent({
      organizationId: integration.organizationId,
      integrationId: integration.id,
      eventId,
      eventType,
      rawPayload: body.ok ? body.value : { unparseable: true },
    }),
    deps.store.touchIntegration(integration.id).catch(() => undefined), // last-seen is best effort
  ])

  if (!recorded.isNew && (recorded.status === 'processed' || recorded.status === 'ignored')) return json(200, { status: 'duplicate' })

  if (!body.ok || !loose?.success) {
    const error = !body.ok ? body.error : `invalid_envelope: ${loose && !loose.success ? describeIssues(loose.error) : 'unknown'}`
    await deps.store.markEvent(recorded.id, 'failed', error)
    deps.log.info('customer webhook rejected', { ...ctx, reason: error })
    return json(400, { error: 'invalid_payload', detail: error })
  }

  if (!CUSTOMER_EVENT_TYPES.includes(eventType as CustomerEventType)) {
    await deps.store.markEvent(recorded.id, 'ignored', `unsupported event_type: ${eventType}`)
    return json(202, { status: 'ignored' })
  }

  // Opt-in per shop. Checked before the content, so a shop that has not switched this on never sees validation errors.
  if (!integration.trackSignups) {
    await deps.store.markEvent(recorded.id, 'ignored', 'signups_off: signup tracking is off for this shop')
    return json(202, { status: 'ignored', reason: 'signups_disabled' })
  }

  const parsed = customerWebhookSchema.safeParse(body.value)
  if (!parsed.success) {
    const error = describeIssues(parsed.error)
    await deps.store.markEvent(recorded.id, 'failed', error)
    deps.log.info('customer webhook validation failed', { ...ctx, reason: error })
    return json(400, { error: 'invalid_payload', detail: error })
  }

  try {
    const ev = parsed.data
    const result = await deps.store.applySignup({
      eventRowId: recorded.id,
      organizationId: integration.organizationId,
      integrationId: integration.id,
      eventType: ev.event_type,
      occurredAt: new Date(ev.occurred_at).toISOString(),
      email: ev.customer.email,
      name: ev.customer.name ?? null,
      phone: ev.customer.phone ?? null,
      externalId: ev.customer.external_id ?? null,
      registeredAt: ev.customer.registered_at ? new Date(ev.customer.registered_at).toISOString() : null,
    })
    // 'disabled': switched off between the check above and the write; the database has already marked the event ignored.
    if (result === 'disabled') return json(202, { status: 'ignored', reason: 'signups_disabled' })
    return json(200, { status: 'processed' })
  } catch (err) {
    deps.log.error('customer webhook processing failed', { ...ctx, message: err instanceof Error ? err.message : 'unknown' })
    await deps.store.markEvent(recorded.id, 'failed', 'internal error').catch(() => {})
    return json(500, { error: 'internal_error' })
  }
}
