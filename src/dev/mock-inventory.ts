/**
 * Dev-only: what the database does for the Inventory screens (migration 0015), computed from invented mock rows so the
 * list, filters, the effective "Notify on" and the price fallback can be tried without a login.
 */
type Row = Record<string, any>

const when = (o: Row) => o.placed_at ?? o.created_at

export function listProducts(db: Record<string, Row[]>, args: Record<string, any> = {}): Row[] {
  const { p_search, p_integration, p_low_only, p_limit = 25, p_offset = 0, p_id } = args
  const term = String(p_search ?? '').toLowerCase()
  const shopName = (id: string) => (db.integrations ?? []).find((i) => i.id === id)?.name ?? 'Shop'
  const rows = (db.products ?? [])
    .filter((p) => (!p_id || p.id === p_id) && (!p_integration || p.integration_id === p_integration))
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
    .map((p) => {
      const lines = (db.order_items ?? [])
        .flatMap((i) => {
          const o = (db.orders ?? []).find((x) => x.id === i.order_id)
          return o && i.sku === p.sku && o.integration_id === p.integration_id ? [{ i, o }] : []
        })
        .sort((a, b) => String(when(b.o)).localeCompare(String(when(a.o))))
      const fromOrders = lines.find(({ i, o }) => i.unit_price_minor != null && o.currency)
      const since = Date.now() - 30 * 86_400_000
      const sold = lines.filter(({ o }) => o.status !== 'cancelled' && new Date(when(o)).getTime() >= since).reduce((n, { i }) => n + (i.quantity ?? 0), 0)
      const effective = p.notify_on_override ?? p.notify_on ?? null
      const hasShopPrice = p.price_minor != null
      return {
        id: p.id, integration_id: p.integration_id, integration_name: shopName(p.integration_id), sku: p.sku, name: p.name, stock: p.stock ?? null,
        notify_on: p.notify_on ?? null, notify_on_override: p.notify_on_override ?? null, effective_notify_on: effective,
        price_minor: hasShopPrice ? p.price_minor : fromOrders?.i.unit_price_minor ?? null, currency: hasShopPrice ? p.currency : fromOrders?.o.currency ?? null,
        price_source: hasShopPrice ? 'api' : fromOrders ? 'orders' : null, unit: p.unit ?? null, category: p.category ?? null, barcode: p.barcode ?? null,
        reported_at: p.reported_at ?? null, sold_30d: sold, low: p.stock != null && effective != null && p.stock <= effective,
      }
    })
    .filter((r) => !p_low_only || r.low)
    .sort((a, b) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name))
  return rows.slice(p_offset, p_offset + p_limit).map((r) => ({ ...r, total_count: rows.length }))
}

export function productOrders(db: Record<string, Row[]>, args: Record<string, any> = {}): Row[] {
  const { p_product, p_limit = 25, p_offset = 0 } = args
  const p = (db.products ?? []).find((x) => x.id === p_product)
  if (!p) return []
  const rows = (db.orders ?? [])
    .map((o) => ({ o, lines: (db.order_items ?? []).filter((i) => i.order_id === o.id && i.sku === p.sku) }))
    .filter(({ o, lines }) => o.integration_id === p.integration_id && lines.length)
    .sort((a, b) => String(when(b.o)).localeCompare(String(when(a.o))))
  return rows.slice(p_offset, p_offset + p_limit).map(({ o, lines }) => ({
    id: o.id, order_number: o.order_number, external_id: o.external_id, placed_at: when(o), status: o.status,
    quantity: lines.reduce((n, i) => n + (i.quantity ?? 0), 0), unit_price_minor: lines[0].unit_price_minor ?? null, currency: o.currency, total_count: rows.length,
  }))
}
