/**
 * Preview-only stand-in for the Supabase client, used when building with MOCK_SUPABASE=1 (see vite.config.ts).
 * It serves invented data so every screen can be rendered and screenshotted without a login or real customer data.
 * It is never part of the production build.
 */
import { mountDataToggle } from './data-toggle'
import { customerOrders, deriveCustomers, listCustomers } from './mock-customers'
import { insightsRpc } from './mock-insights'
import { failuresOlderThan, listFailures } from './mock-failures'
import { listProducts, listSyncRuns, productOrders, stockEstimates, syncRunChanges } from './mock-inventory'
import { buildDataset, readMode } from './mock-datasets'

type Row = Record<string, any>

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const ORG = 'org1'
// Real shop ids are UUIDs and the automation form validates that, so the mock uses UUID-shaped ids too.
const SHOP_1 = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a01'
const SHOP_2 = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a02'

const orders: Row[] = [
  ['o1', '#ORD-99685', 'Ana Petrova', 'ana@example.com', 'MKD', 14923000, 'pending', 'paid', 'unfulfilled', SHOP_1, 1],
  ['o2', '#OMNI-391705', 'Operative', 'buyer1@example.com', 'USD', 15695, 'pending', 'paid', 'unfulfilled', SHOP_2, 11],
  ['o3', '#OMNI-855383', 'Operative', 'buyer1@example.com', 'USD', 14796, 'completed', 'paid', 'fulfilled', SHOP_2, 12],
  ['o4', '#OMNI-313731', 'Marko Ilievski', 'marko@example.com', 'USD', 14796, 'processing', 'authorized', 'unfulfilled', SHOP_2, 40],
  ['o5', '#OMNI-178542', 'Sara Nikolova', 'sara@example.com', 'EUR', 16395, 'cancelled', 'refunded', 'unfulfilled', SHOP_1, 95],
  ['o6', '#1006', null, null, null, null, 'unknown', 'unknown', 'unknown', SHOP_1, 130],
  ['o7', '#1007', 'Ivan Todorov', 'ivan@example.com', 'EUR', 4999, 'completed', 'paid', 'fulfilled', SHOP_1, 300],
].map(([id, num, name, email, cur, total, status, pay, ful, integ, min]) => ({
  id, external_id: String(num).replace('#', ''), order_number: num, customer_name: name, customer_email: email, customer_phone: null,
  placed_at: ago(min as number), currency: cur, subtotal_minor: total, discount_minor: 0, shipping_minor: 0, tax_minor: 0, total_minor: total,
  status, payment_status: pay, fulfillment_status: ful, external_status: status, external_payment_status: pay, external_fulfillment_status: ful,
  billing_address: null, shipping_address: { name: name, line1: 'Main St 1', city: 'Skopje', postal_code: '1000', country: 'MK' }, notes: null,
  data_quality: total ? (integ === SHOP_1 && cur && cur !== 'MKD' ? ['currency_mismatch'] : []) : ['missing_total', 'no_items'], last_event_at: ago(min as number), created_at: ago(min as number), updated_at: ago(min as number),
  organization_id: ORG, integration_id: integ, integrations: { name: integ === SHOP_1 ? 'Game Store' : 'Game Store 2', currency: integ === SHOP_1 ? 'MKD' : 'USD' },
}))

const DEMO_DB: Record<string, Row[]> = {
  memberships: [{ role: 'owner', user_id: 'u1', organization_id: ORG, organizations: { id: ORG, name: 'Game Shop' } }],
  organizations: [{ id: ORG, name: 'Game Shop', failure_retention_days: 90 }],
  orders,
  order_items: [
    { id: 'it1', order_id: 'o1', position: 0, sku: 'GC-50', name: 'Gift card 50', quantity: 2, unit_price_minor: 7000000 },
    { id: 'it2', order_id: 'o2', position: 0, sku: 'KEY-STEAM-10', name: 'Steam key 10', quantity: 3, unit_price_minor: 4999 },
    { id: 'it3', order_id: 'o4', position: 0, sku: 'KEY-STEAM-10', name: 'Steam key 10', quantity: 1, unit_price_minor: 4999 },
    { id: 'it4', order_id: 'o7', position: 0, sku: 'PAD-XL', name: 'Mouse pad XL', quantity: 2, unit_price_minor: 2490 },
  ],
  products: [
    { id: 'pr1', integration_id: SHOP_1, sku: 'GC-50', name: 'Gift card 50', stock: 4, notify_on: 10, notify_on_override: null, price_minor: 7000000, currency: 'MKD', unit: 'pcs', category: 'Gift cards', reported_at: ago(12) },
    { id: 'pr2', integration_id: SHOP_2, sku: 'KEY-STEAM-10', name: 'Steam key 10', stock: 250, notify_on: null, notify_on_override: 50, price_minor: null, currency: null, reported_at: ago(12) },
    { id: 'pr3', integration_id: SHOP_1, sku: 'PAD-XL', name: 'Mouse pad XL', stock: null, notify_on: null, notify_on_override: null, price_minor: null, currency: null, reported_at: null },
    { id: 'pr4', integration_id: SHOP_1, sku: 'NAIL-100', name: 'Steel nails (box of 100)', stock: 4800, notify_on: 5000, notify_on_override: null, price_minor: 350, currency: 'EUR', unit: 'boxes', category: 'Hardware', reported_at: ago(300) },
    { id: 'pr6', integration_id: SHOP_2, sku: 'BIKE-ROAD-700', name: 'Road bike 700c', stock: 3, notify_on: 5, notify_on_override: null, price_minor: 89900, currency: 'EUR', unit: 'pcs', category: 'Bikes', reported_at: ago(30) },
    { id: 'pr5', integration_id: SHOP_1, sku: 'BIKE-ROAD-700', name: 'Road bike 700c', stock: 12, notify_on: 5, notify_on_override: null, price_minor: 89900, currency: 'EUR', unit: 'pcs', category: 'Bikes', reported_at: ago(60) },
  ],
  stock_events: [
    { id: 'se1', product_id: 'pr1', stock_before: 9, stock_after: 4, source: 'push', occurred_at: ago(12) },
    { id: 'se2', product_id: 'pr1', stock_before: 12, stock_after: 9, source: 'pull', occurred_at: ago(60 * 20) },
    { id: 'se3', product_id: 'pr1', stock_before: null, stock_after: 12, source: 'pull', occurred_at: ago(60 * 24 * 3) },
  ],
  product_sync_events: [
    { id: 'ps1', organization_id: ORG, integration_id: SHOP_1, by_name: 'Marko', by_role: 'Admin', products: 1250, notified: 1, created_at: ago(12) },
  ],
  integration_sync: [
    { integration_id: SHOP_1, organization_id: ORG, source_url: 'https://pazarmax.example/workrelay/products', has_auth_header: true, push_enabled: true, paused: false, calls: 15, days: 1, next_sync_at: ago(-50), last_sync_at: ago(46), last_error: null, window_start: ago(60 * 5), window_used: 4, last_push_at: ago(12), last_push_by: 'Marko (Admin)' },
    { integration_id: SHOP_2, organization_id: ORG, source_url: 'https://ignis.example/feed', has_auth_header: false, push_enabled: false, paused: false, calls: 4, days: 7, next_sync_at: ago(-60 * 20), last_sync_at: null, last_error: 'The shop answered with HTTP 503', window_start: ago(60 * 24), window_used: 4, last_push_at: null, last_push_by: null },
  ],
  order_events: [
    { id: 'e1', order_id: 'o1', source: 'external', type: 'order.created', occurred_at: ago(1), actor_user_id: null, data: { applied: ['status', 'totals'], status_to: 'pending' } },
    { id: 'e4', order_id: 'o1', source: 'workrelay', type: 'order.status_changed', occurred_at: ago(0.3), actor_user_id: 'u1', data: { applied: ['status', 'fulfillment_status'], status_from: 'processing', status_to: 'completed', fulfillment_from: 'unfulfilled', fulfillment_to: 'fulfilled', note: 'Handed to the courier, tracking sent to the customer.', by: 'dashboard' } },
    { id: 'e3', order_id: 'o1', source: 'workrelay', type: 'order.status_changed', occurred_at: ago(0.4), actor_user_id: 'u2', data: { applied: ['status'], status_from: 'pending', status_to: 'processing', by: 'dashboard' } },
    { id: 'e2', order_id: 'o1', source: 'workrelay', type: 'note.added', occurred_at: ago(0.5), actor_user_id: 'u1', data: { note: 'Called the customer' } },
  ],
  integrations: [
    { id: SHOP_2, organization_id: ORG, kind: 'commerce', name: 'Game Store 2', status: 'connected', key_prefix: 'wr_live_c2e3', external_store_id: 'ignis-gaming-store', external_base_url: null, bound_at: ago(90), last_seen_at: ago(10), created_at: ago(120), track_signups: true, signups_enabled_at: ago(60 * 24 * 5), currency: 'USD', estimate_stock: true },
    { id: SHOP_1, organization_id: ORG, kind: 'commerce', name: 'Game Store', status: 'connected', key_prefix: 'wr_live_7b84', external_store_id: 'pazarmax', external_base_url: null, bound_at: ago(110), last_seen_at: ago(1), created_at: ago(150), track_signups: false, signups_enabled_at: null, currency: 'MKD', estimate_stock: false },
  ],
  workflows: [
    { id: 'w1', organization_id: ORG, name: 'Notify Discord when a new order arrives', preset: 'notify', preset_config: { event: 'created', channel: 'discord', url: 'https://discord.com/api/webhooks/1/x' }, enabled: true, status: 'published', current_version_id: 'v1', updated_at: ago(27), created_at: ago(30) },
    { id: 'w2', organization_id: ORG, name: 'Review orders above 100', preset: 'review_large', preset_config: { threshold: 100, reviewer_role: 'admin' }, enabled: false, status: 'published', current_version_id: 'v2', updated_at: ago(500), created_at: ago(600) },
    { id: 'w3', organization_id: ORG, name: 'Notify Discord when a customer signs up', preset: 'notify', preset_config: { event: 'customer_signed_up', channel: 'discord', url: 'https://discord.com/api/webhooks/3/x', integration_id: SHOP_2 }, enabled: true, status: 'published', current_version_id: 'v3', updated_at: ago(300), created_at: ago(310) },
    { id: 'w6', organization_id: ORG, name: 'Notify Discord when a customer signs up (all shops)', preset: 'notify', preset_config: { event: 'customer_signed_up', channel: 'discord', url: 'https://discord.com/api/webhooks/6/x' }, enabled: true, status: 'published', current_version_id: 'v6', updated_at: ago(2), created_at: ago(3) },
    { id: 'w5', organization_id: ORG, name: 'Notify Slack when a new order arrives', preset: 'notify', preset_config: { event: 'created', channel: 'slack', url: 'https://hooks.slack.com/services/y', integration_ids: [SHOP_1] }, enabled: true, status: 'published', current_version_id: 'v5', updated_at: ago(100), created_at: ago(110) },
    { id: 'w4', organization_id: ORG, name: 'Notify Slack when a customer signs up', preset: 'notify', preset_config: { event: 'customer_signed_up', channel: 'slack', url: 'https://hooks.slack.com/services/x', integration_id: SHOP_1 }, enabled: true, status: 'published', current_version_id: 'v4', updated_at: ago(200), created_at: ago(210) },
  ],
  workflow_runs: [
    ['r1', 'succeeded', 1, 0.6], ['r2', 'succeeded', 10, 0.5], ['r3', 'succeeded', 11, 1.6], ['r4', 'failed', 60, 0.8], ['r5', 'waiting_approval', 5, null],
  ].map(([id, status, min, dur]) => ({
    id, status, organization_id: ORG, workflow_id: 'w1', version_id: 'v1', trigger_source: 'order_created', event_id: `evt_${id}`, attempt: 1, error: status === 'failed' ? 'HTTP 404' : null,
    started_at: ago(min as number), finished_at: dur ? new Date(Date.now() - (min as number) * 60_000 + (dur as number) * 1000).toISOString() : null, created_at: ago(min as number),
    workflows: { name: 'Notify Discord when a new order arrives' }, workflow_versions: { version: 1 },
    context: { order: { integration_id: Number(String(id).slice(1)) % 2 ? SHOP_1 : SHOP_2 } },
  })),
  step_runs: [
    { id: 's1', run_id: 'r1', step_key: 'notify', step_name: 'Notify Discord', step_type: 'http_request', position: 0, status: 'succeeded', input: { method: 'POST', url: 'https://discord.com/[redacted]' }, output: { status: 204 }, error: null, attempt: 1, started_at: ago(1), finished_at: ago(0.99) },
  ],
  webhook_events: [
    ['order.created', 'evt_ORD-99685_1', 'processed', null, 1], ['order.created', 'evt_OMNI_391705_created', 'processed', null, 10],
    ['order.status_changed', 'evt_OMNI_855383_status', 'processed', null, 11], ['order.created', 'bad-1', 'failed', 'order.totals.total_minor: expected int', 90], ['order.deleted', 'ign-1', 'ignored', 'unsupported event_type', 120],
  ].map(([t, id, status, error, min]) => ({ id: id, integration_id: SHOP_1, event_id: id, event_type: t, status, error, attempt_count: 0, received_at: ago(min as number), processed_at: ago(min as number), organization_id: ORG })).concat([
    { id: 'cust_2041_created', integration_id: SHOP_2, event_id: 'cust_2041:created', event_type: 'customer.created', status: 'processed', error: null, attempt_count: 0, received_at: ago(90), processed_at: ago(90), organization_id: ORG },
  ] as any),
  approvals: [
    { id: 'a1', run_id: 'r5', step_key: 'review', title: 'Review large order #ORD-99685 (149230.00 MKD)', context: { order: { external_id: '99685', integration_id: SHOP_1 } }, reviewer_user_id: null, reviewer_role: 'admin', status: 'pending', decided_by: null, decided_at: null, comment: null, created_at: ago(5), organization_id: ORG },
    { id: 'a2', run_id: 'r1', step_key: 'review', title: 'Review large order #OMNI-391705', context: {}, reviewer_user_id: null, reviewer_role: 'admin', status: 'approved', decided_by: 'u1', decided_at: ago(30), comment: 'Looks fine', created_at: ago(40), organization_id: ORG },
  ],
}

// Dev-only stand-in for preset_fingerprint (migration 0023): the same kind, event, channel, destination and shops are "the same".
function mockPresetKey(preset: string | null, cfg: Row | null): string | null {
  if (!preset || !cfg) return null
  const ids: string[] = Array.isArray(cfg.integration_ids) && cfg.integration_ids.length ? cfg.integration_ids : cfg.integration_id ? [cfg.integration_id] : []
  const shops = ids.length ? [...new Set(ids.map((i) => String(i).toLowerCase()))].sort().join(',') : '*'
  return preset === 'notify'
    ? ['notify', cfg.event, cfg.channel, String(cfg.url ?? '').trim().replace(/\/+$/, ''), shops].join('|')
    : ['review_large', Number(cfg.threshold), cfg.reviewer_role, shops].join('|')
}
/** The message the database gives for a duplicate, or null when there is none. */
function mockDuplicate(rows: Row[], preset: string | null, cfg: Row | null, selfId?: string): string | null {
  const key = mockPresetKey(preset, cfg)
  const other = key ? rows.find((w) => w.id !== selfId && mockPresetKey(w.preset, w.preset_config) === key) : null
  return other ? `This exact automation already exists: "${other.name}" (${other.enabled ? 'it is turned on' : 'it is turned off'}). Edit that one instead.` : null
}
DEMO_DB.workflows.push({ ...DEMO_DB.workflows[0], id: 'w7', current_version_id: 'v7', updated_at: ago(8), created_at: ago(9) }) // an old duplicate of the first one, made before the rule existed
for (const w of DEMO_DB.workflows) w.preset_key = mockPresetKey(w.preset, w.preset_config)

const DEMO_RPC: Record<string, unknown> = {
  is_platform_admin: typeof location !== 'undefined' && new URLSearchParams(location.search).has('admin'),
  list_members: [
    { user_id: 'u1', email: 'owner@example.com', role: 'owner', created_at: ago(5000) },
    { user_id: 'u2', email: 'teammate@example.com', role: 'member', created_at: ago(2000) },
  ],
  admin_list_tenants: [{ id: ORG, name: 'Game Shop', created_at: ago(9000), owner_emails: ['owner@example.com'], members: 2, integrations: 2, workflows: 6, orders: 7, currencies: ['MKD', 'USD'], shops_without_currency: 0 }],
  admin_list_tenant_shops: [
    { id: SHOP_1, name: 'Game Store', status: 'connected', currency: 'MKD', push_enabled: true, calls: 15, days: 1, last_sync_at: ago(46), last_error: null },
    { id: SHOP_2, name: 'Game Store 2', status: 'connected', currency: 'USD', push_enabled: false, calls: null, days: null, last_sync_at: null, last_error: null },
  ],
}

// ?data=worst|empty|one|many swaps the whole dataset at this boundary; the components never know.
const MODE = readMode()
const { DB, RPC } = MODE === 'demo' ? { DB: DEMO_DB, RPC: DEMO_RPC } : buildDataset(MODE, DEMO_DB, DEMO_RPC)
// Shops with signups switched on report some accounts; most of them have not ordered (yet).
const SIGNUPS: Row[] = (DB.integrations ?? []).some((i) => i.track_signups)
  ? [
      { email: 'new.visitor@example.com', name: 'Dimitar Stojanov', registered_at: ago(90), external_id: 'cust_2041', integration_id: SHOP_2 },
      { email: 'lena@example.com', name: null, registered_at: ago(60 * 20), integration_id: SHOP_2 },
      { email: 'buyer1@example.com', name: 'Operative', registered_at: ago(60 * 24 * 6), external_id: 'cust_17', integration_id: SHOP_2 },
    ]
  : []
DB.customers = deriveCustomers(DB.orders ?? [], MODE === 'empty' ? [] : SIGNUPS)
mountDataToggle(MODE)

class Query {
  private filters: ((r: Row) => boolean)[] = []
  private range_?: [number, number]
  private max?: number
  private table: string
  constructor(table: string) {
    this.table = table
  }
  select() { return this }
  eq(col: string, val: unknown) { this.filters.push((r) => !(col in r) || r[col] === val); return this }
  is(col: string, val: unknown) { this.filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return this }
  neq(col: string, val: unknown) { this.filters.push((r) => !(col in r) || r[col] !== val); return this }
  // Only the shop filter used by Overview, Executions and Approvals is understood (context->order->>integration_id.eq.X,...); others are ignored.
  or(filter?: string) {
    const m = /^context->order->>integration_id\.eq\.([^,]+),/.exec(filter ?? '')
    if (m) this.filters.push((r) => r.context?.order?.integration_id === m[1] || r.context?.event?.integration_id === m[1])
    return this
  }
  like(col: string, pattern: string) { const prefix = pattern.replace(/%$/, ''); this.filters.push((r) => String(r[col] ?? '').startsWith(prefix)); return this }
  gte() { return this }
  lt() { return this }
  order() { return this }
  limit(n: number) { this.max = n; return this }
  range(from: number, to: number) { this.range_ = [from, to]; return this }
  patch?: Row
  failure?: { message: string }
  insert(row?: Row) {
    if (this.table === 'workflows') {
      const message = mockDuplicate(DB.workflows ?? [], row?.preset ?? null, row?.preset_config ?? null)
      if (message) { this.failure = { message }; return this }
    }
    const now = new Date().toISOString()
    ;(DB[this.table] ??= []).unshift({ id: `new${Math.random().toString(36).slice(2, 7)}`, created_at: now, updated_at: now, enabled: false, status: 'draft', current_version_id: null, ...row })
    return this
  }
  update(row?: Row) { this.patch = row; return this }
  delete() { return this }
  private rows() {
    const all = (DB[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)))
    const sliced = this.range_ ? all.slice(this.range_[0], this.range_[1] + 1) : this.max ? all.slice(0, this.max) : all
    return { all, sliced }
  }
  single() { return Promise.resolve(this.failure ? { data: null, error: this.failure } : { data: this.rows().all[0] ?? { id: 'new' }, error: null }) }
  maybeSingle() { return Promise.resolve({ data: this.rows().all[0] ?? null, error: null }) }
  then(resolve: (v: unknown) => unknown) {
    if (this.failure) return Promise.resolve({ data: null, error: this.failure }).then(resolve)
    if (this.patch && this.table === 'workflows' && 'preset_config' in this.patch) {
      for (const r of this.rows().all) {
        const message = mockDuplicate(DB.workflows ?? [], r.preset, this.patch.preset_config, r.id)
        if (message) return Promise.resolve({ data: null, error: { message } }).then(resolve)
      }
    }
    if (this.patch) for (const r of this.rows().all) Object.assign(r, this.patch, { current_version_id: r.current_version_id ?? 'v-local', updated_at: new Date().toISOString() })
    const { all, sliced } = this.rows()
    // Copies, like a real database returns: handing back the very objects the mock mutates would hide every change from the cache.
    return Promise.resolve({ data: sliced.map((r) => ({ ...r })), error: null, count: all.length }).then(resolve)
  }
}
const channel: any = { on() { return channel }, subscribe(cb?: (s: string) => void) { cb?.('SUBSCRIBED'); return channel } }

export const isSupabaseConfigured = true
export const errorMessage = (e: unknown) => (e as { message?: string } | null)?.message ?? 'Something went wrong.'
export const supabase: any = {
  from: (table: string) => new Query(table),
  rpc: (name: string, args?: Record<string, any>) => {
    if (name === 'list_customers') return Promise.resolve({ data: listCustomers(DB, args), error: null })
    if (name.startsWith('insights_')) return Promise.resolve({ data: insightsRpc(name, args ?? {}, MODE === 'empty'), error: null })
    if (name === 'list_products') return Promise.resolve({ data: listProducts(DB, args), error: null })
    if (name === 'list_sync_runs') return Promise.resolve({ data: MODE === 'empty' ? [] : listSyncRuns(DB, args), error: null })
    if (name === 'sync_run_changes') return Promise.resolve({ data: syncRunChanges(args), error: null })
    if (name === 'failures_older_than') return Promise.resolve({ data: failuresOlderThan(DB, args), error: null })
    if (name === 'set_failure_retention') {
      if (!(args && args.p_days >= 1 && args.p_days <= 365)) return Promise.resolve({ data: null, error: { message: 'Keep failures for between 1 and 365 days.' } })
      for (const o of DB.organizations ?? []) if (o.id === args?.p_org) o.failure_retention_days = args?.p_days
      return Promise.resolve({ data: failuresOlderThan(DB, { p_days: args?.p_days }), error: null })
    }
    if (name === 'list_failures') return Promise.resolve({ data: MODE === 'empty' ? [] : listFailures(DB, args), error: null })
    if (name === 'stock_estimates') return Promise.resolve({ data: stockEstimates(DB, args), error: null })
    if (name === 'set_integration_estimate_stock') {
      for (const i of DB.integrations ?? []) if (i.id === args?.p_id) i.estimate_stock = !!args?.p_enabled
      return Promise.resolve({ data: null, error: null })
    }
    if (name === 'product_siblings') {
      const me = (DB.products ?? []).find((x) => x.id === args?.p_product)
      const shop = (id: string) => (DB.integrations ?? []).find((i) => i.id === id)?.name ?? 'Shop'
      const rows = (DB.products ?? []).filter((x) => me && x.sku === me.sku && x.id !== me.id).map((x) => {
        const eff = x.notify_on_override ?? x.notify_on ?? null
        return { id: x.id, integration_id: x.integration_id, integration_name: shop(x.integration_id), stock: x.stock ?? null, unit: x.unit ?? null, reported_at: x.reported_at ?? null, low: x.stock != null && eff != null && x.stock <= eff }
      })
      return Promise.resolve({ data: rows, error: null })
    }
    if (name === 'product_orders') return Promise.resolve({ data: productOrders(DB, args), error: null })
    if (name === 'delete_automation') {
      const w = (DB.workflows ?? []).find((x) => x.id === args?.p_id)
      if (w) Object.assign(w, { deleted_at: w.deleted_at ?? new Date().toISOString(), enabled: false, preset_key: null })
      return Promise.resolve({ data: null, error: null })
    }
    if (name === 'admin_set_push_enabled') {
      for (const s of (RPC.admin_list_tenant_shops as Row[]) ?? []) if (s.id === args?.p_integration) s.push_enabled = !!args?.p_enabled
      for (const r of DB.integration_sync ?? []) if (r.integration_id === args?.p_integration) r.push_enabled = !!args?.p_enabled
      return Promise.resolve({ data: null, error: null })
    }
    if (name === 'set_integration_currency' || name === 'admin_set_shop_currency') {
      const id = args?.p_id ?? args?.p_integration
      const code = String(args?.p_currency ?? '').trim().toUpperCase()
      if (!/^[A-Z]{3}$/.test(code)) return Promise.resolve({ data: null, error: { message: 'currency must be a three-letter code, such as MKD or USD' } })
      for (const i of DB.integrations ?? []) if (i.id === id) i.currency = code
      for (const s of (RPC.admin_list_tenant_shops as Row[]) ?? []) if (s.id === id) s.currency = code
      return Promise.resolve({ data: null, error: null })
    }
    if (name === 'set_notify_override') {
      const p = (DB.products ?? []).find((x) => x.id === args?.p_product)
      if (p) p.notify_on_override = args?.p_value ? args.p_value : null
      return Promise.resolve({ data: null, error: null })
    }
    if (name === 'customer_orders') return Promise.resolve({ data: customerOrders(DB, args), error: null })
    return Promise.resolve({ data: RPC[name] ?? null, error: null })
  },
  functions: {
    invoke: (name: string, opts?: { body?: { integration_id?: string } }) => {
      if (name !== 'sync-now') return Promise.resolve({ data: {}, error: null })
      // Dev stand-in for the sync-now function: spends a call from the shop's window and stamps the check.
      const row = (DB.integration_sync ?? []).find((r) => r.integration_id === opts?.body?.integration_id)
      if (!row || row.calls == null) return Promise.resolve({ data: null, error: { context: new Response(JSON.stringify({ error: 'not_scheduled', detail: 'WorkRelay has not set up scheduled checks for this shop yet.' }), { status: 409 }) } })
      row.window_used += 1
      row.last_sync_at = new Date().toISOString()
      return Promise.resolve({ data: { status: 'ok', products: 6, calls_left: row.calls - row.window_used }, error: null })
    },
  },
  channel: () => channel,
  removeChannel: () => Promise.resolve('ok'),
  auth: {
    // `localStorage['mock-signed-out'] = '1'` shows the signed-out pages (the landing page) in the preview.
    getSession: () => Promise.resolve({ data: { session: localStorage.getItem('mock-signed-out') === '1' ? null : { user: { id: 'u1', email: 'owner@example.com' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
    signInWithPassword: () => Promise.resolve({ error: null, data: {} }),
    signUp: () => Promise.resolve({ error: null, data: { session: null } }),
  },
}
