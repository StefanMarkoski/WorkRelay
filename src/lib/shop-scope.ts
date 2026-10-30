/**
 * Automation runs and approvals have no shop column of their own: the shop is inside the context they carry, under the
 * order (order automations) or the event (customer and low-stock automations). These two helpers read it and filter on it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A PostgREST `or` filter for rows whose context belongs to this shop. An id that is not a UUID matches nothing. */
export function contextShopFilter(shopId: string): string {
  if (!UUID.test(shopId)) return 'id.is.null' // never interpolate anything else into a filter
  return `context->order->>integration_id.eq.${shopId},context->event->>integration_id.eq.${shopId}`
}

/** The shop a run or approval belongs to, or null if its context does not say. */
export function shopIdOfContext(context: unknown): string | null {
  const c = context as { order?: { integration_id?: unknown }; event?: { integration_id?: unknown } } | null | undefined
  const id = c?.order?.integration_id ?? c?.event?.integration_id
  return typeof id === 'string' ? id : null
}
