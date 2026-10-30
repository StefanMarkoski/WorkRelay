/**
 * Preview-only stand-in for the Supabase client, used when building with MOCK_SUPABASE=1 (see vite.config.ts).
 * It serves invented data so every screen can be rendered and screenshotted without a login or real customer data.
 * It is never part of the production build.
 */
import { mountDataToggle } from './data-toggle'
import { customerOrders, deriveCustomers, listCustomers } from './mock-customers'
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
  data_quality: total ? [] : ['missing_total', 'no_items'], last_event_at: ago(min as number), created_at: ago(min as number), updated_at: ago(min as number),
  organization_id: ORG, integration_id: integ, integrations: { name: integ === SHOP_1 ? 'Game Store' : 'Game Store 2' },
}))

const DEMO_DB: Record<string, Row[]> = {
  memberships: [{ role: 'owner', user_id: 'u1', organization_id: ORG, organizations: { id: ORG, name: 'Game Shop' } }],
  orders,
  order_items: [{ id: 'it1', order_id: 'o1', position: 0, sku: 'GC-50', name: 'Gift card 50', quantity: 2, unit_price_minor: 7000000 }],
  order_events: [
    { id: 'e1', order_id: 'o1', source: 'external', type: 'order.created', occurred_at: ago(1), actor_user_id: null, data: { applied: ['status', 'totals'], status_to: 'pending' } },
    { id: 'e4', order_id: 'o1', source: 'workrelay', type: 'order.status_changed', occurred_at: ago(0.3), actor_user_id: 'u1', data: { applied: ['status', 'fulfillment_status'], status_from: 'processing', status_to: 'completed', fulfillment_from: 'unfulfilled', fulfillment_to: 'fulfilled', note: 'Handed to the courier, tracking sent to the customer.', by: 'dashboard' } },
    { id: 'e3', order_id: 'o1', source: 'workrelay', type: 'order.status_changed', occurred_at: ago(0.4), actor_user_id: 'u2', data: { applied: ['status'], status_from: 'pending', status_to: 'processing', by: 'dashboard' } },
    { id: 'e2', order_id: 'o1', source: 'workrelay', type: 'note.added', occurred_at: ago(0.5), actor_user_id: 'u1', data: { note: 'Called the customer' } },
  ],
  integrations: [
    { id: SHOP_2, organization_id: ORG, kind: 'commerce', name: 'Game Store 2', status: 'connected', key_prefix: 'wr_live_c2e3', external_store_id: 'ignis-gaming-store', external_base_url: null, bound_at: ago(90), last_seen_at: ago(10), created_at: ago(120), track_signups: true, signups_enabled_at: ago(60 * 24 * 5) },
    { id: SHOP_1, organization_id: ORG, kind: 'commerce', name: 'Game Store', status: 'connected', key_prefix: 'wr_live_7b84', external_store_id: 'pazarmax', external_base_url: null, bound_at: ago(110), last_seen_at: ago(1), created_at: ago(150), track_signups: false, signups_enabled_at: null },
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
    { id: 'a1', run_id: 'r5', step_key: 'review', title: 'Review large order #ORD-99685 (149230.00 MKD)', context: { order: { external_id: '99685' } }, reviewer_user_id: null, reviewer_role: 'admin', status: 'pending', decided_by: null, decided_at: null, comment: null, created_at: ago(5), organization_id: ORG },
    { id: 'a2', run_id: 'r1', step_key: 'review', title: 'Review large order #OMNI-391705', context: {}, reviewer_user_id: null, reviewer_role: 'admin', status: 'approved', decided_by: 'u1', decided_at: ago(30), comment: 'Looks fine', created_at: ago(40), organization_id: ORG },
  ],
}

const DEMO_RPC: Record<string, unknown> = {
  is_platform_admin: false,
  list_members: [
    { user_id: 'u1', email: 'owner@example.com', role: 'owner', created_at: ago(5000) },
    { user_id: 'u2', email: 'teammate@example.com', role: 'member', created_at: ago(2000) },
  ],
  admin_list_tenants: [],
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
  neq(col: string, val: unknown) { this.filters.push((r) => !(col in r) || r[col] !== val); return this }
  or() { return this }
  like(col: string, pattern: string) { const prefix = pattern.replace(/%$/, ''); this.filters.push((r) => String(r[col] ?? '').startsWith(prefix)); return this }
  gte() { return this }
  lt() { return this }
  order() { return this }
  limit(n: number) { this.max = n; return this }
  range(from: number, to: number) { this.range_ = [from, to]; return this }
  patch?: Row
  insert(row?: Row) {
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
  single() { return Promise.resolve({ data: this.rows().all[0] ?? { id: 'new' }, error: null }) }
  maybeSingle() { return Promise.resolve({ data: this.rows().all[0] ?? null, error: null }) }
  then(resolve: (v: unknown) => unknown) {
    if (this.patch) for (const r of this.rows().all) Object.assign(r, this.patch, { current_version_id: r.current_version_id ?? 'v-local', updated_at: new Date().toISOString() })
    const { all, sliced } = this.rows()
    return Promise.resolve({ data: sliced, error: null, count: all.length }).then(resolve)
  }
}
const channel: any = { on() { return channel }, subscribe(cb?: (s: string) => void) { cb?.('SUBSCRIBED'); return channel } }

export const isSupabaseConfigured = true
export const errorMessage = (e: unknown) => (e as { message?: string } | null)?.message ?? 'Something went wrong.'
export const supabase: any = {
  from: (table: string) => new Query(table),
  rpc: (name: string, args?: Record<string, any>) => {
    if (name === 'list_customers') return Promise.resolve({ data: listCustomers(DB, args), error: null })
    if (name === 'customer_orders') return Promise.resolve({ data: customerOrders(DB, args), error: null })
    return Promise.resolve({ data: RPC[name] ?? null, error: null })
  },
  functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  channel: () => channel,
  removeChannel: () => Promise.resolve('ok'),
  auth: {
    getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1', email: 'owner@example.com' } } } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({}),
    signInWithPassword: () => Promise.resolve({ error: null, data: {} }),
    signUp: () => Promise.resolve({ error: null, data: { session: null } }),
  },
}
