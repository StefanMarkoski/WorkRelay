/**
 * Dev-only: what the database does for the Customers screens (migration 0011), computed from the mock orders so
 * every dataset (demo, worst, empty, one, many) gets matching customers without a second set of fixtures.
 */
type Row = Record<string, any>

const ORG = 'org1'
const keyOf = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '')

export function deriveCustomers(orders: Row[], signups: Row[] = []): Row[] {
  const byKey = new Map<string, Row>()
  for (const o of orders) {
    const k = keyOf(o.customer_email)
    if (!k) continue
    const at = o.placed_at ?? o.created_at
    const c = byKey.get(k)
    if (!c) {
      byKey.set(k, { id: `c-${k}`, organization_id: o.organization_id, email_key: k, email: o.customer_email.trim(), name: o.customer_name ?? null, phone: o.customer_phone ?? null, profile_at: at, first_seen_at: at })
    } else {
      if (at > c.profile_at) Object.assign(c, { email: o.customer_email.trim(), name: o.customer_name ?? c.name, phone: o.customer_phone ?? c.phone, profile_at: at })
      if (at < c.first_seen_at) c.first_seen_at = at
    }
  }
  // People the shop reported as signed up (some have also ordered, most have not).
  for (const g of signups) {
    const k = keyOf(g.email)
    const c = byKey.get(k)
    if (c) Object.assign(c, { registered_at: g.registered_at, external_id: g.external_id ?? null, signup_integrations: [...(c.signup_integrations ?? []), g.integration_id] })
    else byKey.set(k, { id: `c-${k}`, organization_id: ORG, email_key: k, email: g.email, name: g.name ?? null, phone: null, external_id: g.external_id ?? null, registered_at: g.registered_at, signup_integrations: [g.integration_id], profile_at: g.registered_at, first_seen_at: g.registered_at })
  }
  return [...byKey.values()]
}

const when = (o: Row) => o.placed_at ?? o.created_at

export function listCustomers(db: Record<string, Row[]>, args: Record<string, any> = {}): Row[] {
  const { p_search, p_limit = 25, p_offset = 0, p_id, p_scope = 'ordered', p_integration } = args
  const term = String(p_search ?? '').toLowerCase()
  const ofShop = (o: Row) => !p_integration || o.integration_id === p_integration
  const ordered = (c: Row) => (db.orders ?? []).some((o) => keyOf(o.customer_email) === c.email_key && ofShop(o))
  const registered = (c: Row) => (p_integration ? !!c.signup_integrations?.includes(p_integration) : !!c.registered_at)
  const inScope = (c: Row) => (p_id || p_scope === 'all' ? ordered(c) || registered(c) : p_scope === 'registered' ? !ordered(c) && registered(c) : ordered(c))
  const rows = (db.customers ?? [])
    .filter((c) => inScope(c) && (!p_id || c.id === p_id) && (!term || c.email.toLowerCase().includes(term) || (c.name ?? '').toLowerCase().includes(term)))
    .map((c) => {
      const mine = (db.orders ?? []).filter((o) => keyOf(o.customer_email) === c.email_key && ofShop(o))
      const spent: Record<string, number> = {}
      for (const o of mine) if (o.currency && o.total_minor != null && o.status !== 'cancelled') spent[o.currency] = (spent[o.currency] ?? 0) + o.total_minor
      return { id: c.id, name: c.name, email: c.email, phone: c.phone, first_seen_at: c.first_seen_at, last_order_at: mine.map(when).sort().at(-1) ?? null, order_count: mine.length, spent, registered_at: c.registered_at ?? null, external_id: c.external_id ?? null }
    })
    .sort((a, b) => String(b.last_order_at ?? b.registered_at).localeCompare(String(a.last_order_at ?? a.registered_at)))
  return rows.slice(p_offset, p_offset + p_limit).map((r) => ({ ...r, total_count: rows.length }))
}

export function customerOrders(db: Record<string, Row[]>, args: Record<string, any> = {}): Row[] {
  const { p_customer, p_limit = 25, p_offset = 0 } = args
  const c = (db.customers ?? []).find((x) => x.id === p_customer)
  if (!c) return []
  const mine = (db.orders ?? [])
    .filter((o) => keyOf(o.customer_email) === c.email_key)
    .sort((a, b) => String(when(b)).localeCompare(String(when(a))))
  return mine.slice(p_offset, p_offset + p_limit).map((o) => ({
    id: o.id, order_number: o.order_number, external_id: o.external_id, placed_at: when(o), status: o.status, payment_status: o.payment_status,
    fulfillment_status: o.fulfillment_status, currency: o.currency, total_minor: o.total_minor, integration_name: o.integrations?.name ?? null, total_count: mine.length,
  }))
}
