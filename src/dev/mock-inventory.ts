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

/** Mirrors the database's stock_estimates: the last reported stock minus the orders placed after that report. */
export function stockEstimates(db: Record<string, Row[]>, args: Record<string, any> = {}): Row[] {
  const { p_ids } = args
  return (db.products ?? [])
    .filter((p) => (db.integrations ?? []).some((i) => i.id === p.integration_id && i.estimate_stock) && p.stock != null && p.reported_at && (!p_ids || p_ids.includes(p.id)))
    .map((p) => {
      let sold = 0
      for (const it of db.order_items ?? []) {
        const o = (db.orders ?? []).find((x) => x.id === it.order_id)
        if (!o || o.integration_id !== p.integration_id || o.status === 'cancelled' || String(it.sku ?? '').trim() !== p.sku) continue
        if (new Date(o.placed_at ?? o.created_at).getTime() > new Date(p.reported_at).getTime()) sold += it.quantity ?? 0
      }
      return { product_id: p.id, estimated: p.stock - sold, sold_since: sold, as_of: p.reported_at }
    })
}

/** Demo sync history (mock only): a mix of pushes, scheduled and manual pulls, and two failures. */
export function demoSyncRuns(db: Record<string, Row[]>): Row[] {
  const shops = db.integrations ?? []
  const a = shops[0], b = shops[1] ?? shops[0]
  if (!a) return []
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
  const base = { organization_id: a.organization_id, error: null }
  return [
    { id: 'sr1', integration_id: a.id, source: 'push', trigger: 'shop', by_name: 'Marko', by_role: 'Admin', received: 120, changed: 14, status: 'ok', created_at: ago(12), ...base },
    { id: 'sr2', integration_id: b.id, source: 'pull', trigger: 'scheduled', by_name: null, by_role: null, received: 40, changed: 3, status: 'ok', created_at: ago(35), ...base },
    { id: 'sr3', integration_id: a.id, source: 'pull', trigger: 'manual', by_name: null, by_role: null, received: 118, changed: 0, status: 'ok', created_at: ago(95), ...base },
    { id: 'sr4', integration_id: b.id, source: 'pull', trigger: 'scheduled', by_name: null, by_role: null, received: 0, changed: 0, status: 'failed', created_at: ago(180), organization_id: a.organization_id, error: 'The shop answered with HTTP 500' },
    { id: 'sr5', integration_id: a.id, source: 'push', trigger: 'shop', by_name: null, by_role: null, received: 0, changed: 0, status: 'failed', created_at: ago(300), organization_id: a.organization_id, error: 'products.0.stock: expected number, received string' },
    { id: 'sr6', integration_id: a.id, source: 'push', trigger: 'shop', by_name: 'Ana', by_role: null, received: 2, changed: 2, status: 'ok', created_at: ago(1500), ...base },
  ]
}

const DEMO_CHANGES: Row[] = [
  { sku: 'BIKE-ROAD-700', name: 'Road bike 700c', stock_before: 12, stock_after: 3 },
  { sku: 'GC-50', name: 'Gift card 50', stock_before: 9, stock_after: 4 },
  { sku: 'KEY-STEAM-10', name: 'Steam key 10', stock_before: null, stock_after: 250 },
]

/** Mirrors list_sync_runs (sorting and paging) and sync_run_changes. */
export function listSyncRuns(db: Record<string, Row[]>, args: Record<string, any> = {}): Row[] {
  const { p_integration, p_sort = 'time', p_desc = true, p_limit = 25, p_offset = 0 } = args
  const name = (id: string) => (db.integrations ?? []).find((i) => i.id === id)?.name ?? 'Shop'
  const key: Record<string, (r: Row) => string | number> = {
    time: (r) => new Date(r.created_at).getTime(), source: (r) => r.source, shop: (r) => name(r.integration_id).toLowerCase(),
    by: (r) => String(r.by_name ?? '').toLowerCase(), products: (r) => r.received, changes: (r) => r.changed, result: (r) => r.status,
  }
  const pick = key[p_sort] ?? key.time
  const rows = demoSyncRuns(db).filter((r) => !p_integration || r.integration_id === p_integration)
  rows.sort((x, y) => (pick(x) < pick(y) ? -1 : pick(x) > pick(y) ? 1 : 0) * (p_desc ? -1 : 1) || new Date(y.created_at).getTime() - new Date(x.created_at).getTime())
  return rows.slice(p_offset, p_offset + p_limit).map((r) => ({ ...r, integration_name: name(r.integration_id), total_count: rows.length }))
}
export const syncRunChanges = (args: Record<string, any> = {}): Row[] =>
  (['sr1', 'sr2', 'sr6'].includes(args.p_run) ? DEMO_CHANGES : []).map((c) => ({ ...c, total_count: args.p_run === 'sr1' ? 14 : DEMO_CHANGES.length }))
