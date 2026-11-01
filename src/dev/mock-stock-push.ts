type Row = Record<string, any>

/** Mirrors the stock write-back functions for the mock build (the real rules are in migration 0043, and tested there). */
const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

export function seedStockPush(db: Record<string, Row[]>) {
  const [a, b] = db.integrations ?? []
  if (!a) return
  for (const i of db.integrations ?? []) {
    Object.assign(i, { stock_push_url: null, stock_push_has_url: false, stock_push_enabled: false, stock_push_verified_at: null, stock_push_locked: false, stock_push_paused_reason: null, stock_push_has_secret: false })
  }
  Object.assign(a, { estimate_stock: true, stock_push_url: 'https://shop.example.com/workrelay/stock', stock_push_has_url: true, stock_push_enabled: true, stock_push_verified_at: ago(60 * 5), stock_push_has_secret: true })
  if (b) Object.assign(b, { estimate_stock: true })
  db.stock_conflicts = [
    { id: 'c1', integration_id: a.id, integration_name: a.name, product_id: 'p1', sku: 'TEE-BLK-M', name: 'Black tee (M)', workrelay_value: 10, shop_value: 8, detected_at: ago(35), status: 'open', decided_at: null },
    { id: 'c2', integration_id: a.id, integration_name: a.name, product_id: 'p2', sku: 'MUG-WHITE', name: 'White mug', workrelay_value: 3, shop_value: 12, detected_at: ago(90), status: 'open', decided_at: null },
    { id: 'c3', integration_id: a.id, integration_name: a.name, product_id: 'p3', sku: 'SOCKS-3', name: 'Socks 3-pack', workrelay_value: 4, shop_value: 9, detected_at: ago(300), status: 'kept_shop', decided_at: ago(280) },
    { id: 'c4', integration_id: a.id, integration_name: a.name, product_id: 'p4', sku: 'CAP-NVY', name: 'Navy cap', workrelay_value: 39, shop_value: 33, detected_at: ago(200), status: 'sent_workrelay', decided_at: ago(190) },
  ]
  db.stock_push_requests = [
    { id: 'r1', integration_id: a.id, integration_name: a.name, kind: 'stock', item_count: 2, status: 'ok', http_status: 200, error: null, created_at: ago(4), finished_at: ago(4) },
    { id: 'r2', integration_id: a.id, integration_name: a.name, kind: 'stock', item_count: 1, status: 'failed', http_status: 500, error: 'The shop answered with HTTP 500.', created_at: ago(40), finished_at: ago(40) },
    { id: 'r3', integration_id: a.id, integration_name: a.name, kind: 'test', item_count: 0, status: 'ok', http_status: 200, error: null, created_at: ago(60 * 5), finished_at: ago(60 * 5) },
  ]
}

const ITEMS: Record<string, Row[]> = {
  r1: [
    { sku: 'TEE-BLK-M', name: 'Black tee (M)', stock: 7, status: 'sent', note: null, reason: 'order', conflict_shop: null, conflict_workrelay: null },
    { sku: 'CAP-NVY', name: 'Navy cap', stock: 39, status: 'sent', note: null, reason: 'conflict', conflict_shop: 33, conflict_workrelay: 39 },
  ],
  r2: [{ sku: 'SOCKS-3', name: 'Socks 3-pack', stock: 4, status: 'pending', note: 'The shop answered with HTTP 500.', reason: 'order', conflict_shop: null, conflict_workrelay: null }],
}

export function stockPushRpc(db: Record<string, Row[]>, name: string, args: Record<string, any> = {}): { handled: boolean; data?: unknown; error?: { message: string } } {
  const shop = (id: string) => (db.integrations ?? []).find((i) => i.id === (args.p_integration ?? args.p_id ?? id))
  if (name === 'list_stock_conflicts') {
    const rows = (db.stock_conflicts ?? []).filter((c) => (args.p_status === 'open' ? c.status === 'open' : args.p_status === 'decided' ? c.status !== 'open' : true))
    return { handled: true, data: rows.map((r) => ({ ...r, total_count: rows.length })) }
  }
  if (name === 'resolve_stock_conflict') {
    const c = (db.stock_conflicts ?? []).find((x) => x.id === args.p_conflict)
    if (!c || c.status !== 'open') return { handled: true, error: { message: 'This conflict was already decided.' } }
    c.status = args.p_choice === 'shop' ? 'kept_shop' : 'sent_workrelay'
    c.decided_at = new Date().toISOString()
    return { handled: true, data: null }
  }
  if (name === 'list_stock_pushes') {
    const all = [...(db.stock_push_requests ?? [])].sort((x, y) => y.created_at.localeCompare(x.created_at))
    const off = args.p_offset ?? 0
    return { handled: true, data: all.slice(off, off + (args.p_limit ?? 25)).map((r) => ({ ...r, total_count: all.length })) }
  }
  if (name === 'stock_push_request_items') {
    const rows = ITEMS[args.p_request] ?? []
    return { handled: true, data: rows.map((r) => ({ ...r, total_count: rows.length })) }
  }
  if (name === 'stock_push_status') {
    const a = (db.integrations ?? [])[0]
    return { handled: true, data: a ? [{ integration_id: a.id, integration_name: a.name, enabled: true, waiting: 3, checking: 1, reads_used: 12, reads_limit: 60, resets_at: new Date(Date.now() + 38 * 60_000).toISOString(), oldest: new Date(Date.now() - 2 * 60_000).toISOString() }] : [] }
  }
  if (name === 'get_stock_push_url') return { handled: true, data: shop(args.p_integration)?.stock_push_url ?? null }
  if (name === 'set_stock_push_url') {
    const i = shop(args.p_integration)
    const u = String(args.p_url ?? '').trim()
    if (u && !/^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:443)?(\/\S*)?$/.test(u)) return { handled: true, error: { message: 'Use a full https address on the standard port, for example https://shop.example.com/workrelay/stock. No login in the address.' } }
    Object.assign(i ?? {}, { stock_push_url: u || null, stock_push_has_url: !!u, stock_push_enabled: false, stock_push_verified_at: null, stock_push_paused_reason: null })
    return { handled: true, data: null }
  }
  if (name === 'rotate_stock_push_secret') {
    Object.assign(shop(args.p_integration) ?? {}, { stock_push_has_secret: true, stock_push_enabled: false, stock_push_verified_at: null })
    return { handled: true, data: 'wr_sign_' + 'a1b2c3d4'.repeat(8) }
  }
  if (name === 'set_stock_push_enabled') {
    const i = shop(args.p_integration)
    if (args.p_enabled && !(i?.stock_push_verified_at)) return { handled: true, error: { message: 'Send a test first: the shop has to answer a signed request correctly.' } }
    Object.assign(i ?? {}, { stock_push_enabled: !!args.p_enabled, stock_push_paused_reason: null })
    return { handled: true, data: null }
  }
  return { handled: false }
}

export function stockPushTest(db: Record<string, Row[]>, integrationId: string): { status: 'ok' | 'failed'; error?: string } {
  const i = (db.integrations ?? []).find((x) => x.id === integrationId)
  if (!i?.stock_push_url || !i.stock_push_has_secret) return { status: 'failed', error: 'Create a signing secret first.' }
  if (/fail/.test(i.stock_push_url)) return { status: 'failed', error: 'The shop answered with HTTP 401.' }
  i.stock_push_verified_at = new Date().toISOString()
  return { status: 'ok' }
}
