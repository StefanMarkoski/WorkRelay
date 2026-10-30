/**
 * Dev-only datasets for the mock-data app (MOCK_SUPABASE=1). Never part of a production build.
 * Every value is either realistic or the real limit from supabase/functions/_shared/order-contract.ts
 * (order number 100, customer name 200, email 320, item name 500, sku 200, event id 200, notes 5000, items 1000).
 * Pick one with ?data=worst | empty | one | many in the URL, or with the switch at the bottom of the screen.
 */
type Row = Record<string, any>

export type DataMode = 'demo' | 'worst' | 'empty' | 'one' | 'many'
export const DATA_MODES: { id: DataMode; label: string }[] = [
  { id: 'demo', label: 'Demo data' },
  { id: 'worst', label: 'Worst case' },
  { id: 'empty', label: 'Empty' },
  { id: 'one', label: 'One' },
  { id: 'many', label: '1,000+ rows' },
]

export function readMode(): DataMode {
  const v = new URLSearchParams(window.location.search).get('data')
  return DATA_MODES.some((m) => m.id === v) ? (v as DataMode) : 'demo'
}

const ORG = 'org1'
const SHOP_1 = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a01'
const SHOP_2 = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a02'
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const ahead = (min: number) => new Date(Date.now() + min * 60_000).toISOString()

const LONG_STORE = 'Pazarmax - Official Online Storefront (North Macedonia, Serbia, Bulgaria, Montenegro, Albania)'
const LONG_EMAIL = 'aleksandra.wisniewska-kowalczyk@northwind-industries-holdings.example.com'
const LONG_FOLK = 'bartholomew.fitzgerald@northwind-industries-holdings.example.com'
const LONG_AUTOMATION = 'Notify the fulfilment team on Discord when a high-value order arrives from the EU storefront'
const LONG_ORDER_NO = '#PRE-ORDER-2026-EU-WEST-000184203-REPLACEMENT'
const LONG_ITEM = 'Premium Wireless Noise-Cancelling Over-Ear Bluetooth Headphones with Active Charcoal Matte Finish - Limited Edition 2026 Holiday Bundle (EU Plug)'
const LONG_URL = 'https://tracking.northwind-logistics-international.example.com/shipments/2026/10/EU-WEST/000184203/REPLACEMENT/label?ref=customer-service-escalation-1042&utm_source=email'
// A pasted email thread of the kind a support person adds as an internal note (the UI box allows 2000, the backend 5000).
const LONG_NOTE = `Customer called twice about the replacement. ${'She says the first parcel arrived damaged and the courier refused to take it back. '.repeat(8)}Tracking: ${LONG_URL}`

type OrderArgs = {
  id: string; num: string | null; name: string | null; email: string | null; cur: string | null; total: number | null
  status?: string; pay?: string; ful?: string; integ?: string; min: number; ext?: string; notes?: string | null; future?: boolean; quality?: string[]
}
function order(a: OrderArgs, integName: string): Row {
  const at = a.future ? ahead(a.min) : ago(a.min)
  const total = a.total
  return {
    id: a.id, external_id: (a.num ?? a.id).replace('#', ''), order_number: a.num, customer_name: a.name, customer_email: a.email, customer_phone: null,
    placed_at: at, currency: a.cur, subtotal_minor: total, discount_minor: 0, shipping_minor: 0, tax_minor: 0, total_minor: total,
    status: a.status ?? 'pending', payment_status: a.pay ?? 'paid', fulfillment_status: a.ful ?? 'unfulfilled',
    external_status: a.ext ?? a.status ?? 'pending', external_payment_status: a.pay ?? 'paid', external_fulfillment_status: a.ful ?? 'unfulfilled',
    billing_address: null,
    shipping_address: a.name
      ? { name: a.name, line1: 'Apartment 14B, Building C, Block 7, Residential Complex "Zeleni Dvorovi", Boulevard Partizanski Odredi 112-116', line2: 'Entrance 2, intercom code 4471', city: 'Skopje', region: 'Skopje Statistical Region', postal_code: '1000', country: 'North Macedonia' }
      : null,
    notes: a.notes ?? null, data_quality: a.quality ?? [], last_event_at: at, created_at: at, updated_at: at,
    organization_id: ORG, integration_id: a.integ ?? SHOP_1, integrations: { name: integName },
  }
}

function worstOrders(): Row[] {
  return [
    order({ id: 'w1', num: LONG_ORDER_NO, name: 'Aleksandra Wiśniewska-Kowalczyk', email: LONG_EMAIL, cur: 'EUR', total: 1234567890, status: 'processing', pay: 'authorized', ext: 'awaiting_customer_pickup_confirmation_at_partner_locker', notes: LONG_NOTE, min: 3 }, LONG_STORE),
    order({ id: 'w2', num: '#1', name: 'J', email: 'j@x.io', cur: 'USD', total: 0, status: 'completed', ful: 'fulfilled', min: 12 }, 'Game Store'),
    order({ id: 'w3', num: '#10482', name: null, email: LONG_FOLK, cur: 'JPY', total: 5000, min: 30 }, 'Game Store'),
    order({ id: 'w4', num: '#10483', name: '🎮 Gaming Zone Ltd.', email: 'orders@gaming-zone.example', cur: 'MKD', total: 14923000, min: 45 }, 'Game Store'),
    order({ id: 'w5', num: '#10484', name: 'محمد الأحمد', email: 'm.alahmed@example.ae', cur: 'AED', total: 1999900, min: 60 }, 'Game Store'),
    order({ id: 'w6', num: '#10485', name: '田中 太郎', email: 'taro.tanaka@example.jp', cur: 'JPY', total: 1250000, min: 90 }, 'Game Store'),
    order({ id: 'w7', num: '#10486', name: 'Nguyễn Thị Minh Khai Phương Thảo', email: 'nguyen.thi@example.vn', cur: 'VND', total: 2500000000, min: 120 }, 'Game Store'),
    order({ id: 'w8', num: '#10487', name: null, email: null, cur: null, total: null, status: 'unknown', pay: 'unknown', ful: 'unknown', quality: ['missing_total', 'no_items'], min: 150 }, 'Game Store'),
    order({ id: 'w9', num: '#10488', name: 'Jo', email: 'jo@x.co', cur: 'KWD', total: 12500, min: 200 }, 'Game Store'),
    order({ id: 'w10', num: '#10489', name: 'Marko Ilievski', email: 'marko@example.com', cur: 'USD', total: 14796, status: 'cancelled', pay: 'refunded', min: 3, future: true }, 'Game Store'),
    order({ id: 'w11', num: '#10490', name: 'Christopher Montgomery-Fitzgerald III', email: 'c@m.fitz', cur: 'IDR', total: 250000000000, min: 60 * 24 * 700 }, 'Game Store'),
    order({ id: 'w12', num: '#10491', name: '👨‍👩‍👧 Family Store', email: 'hello@family-store.example', cur: 'CHF', total: 1, min: 400 }, 'Game Store'),
    order({ id: 'w13', num: '#10492', name: 'Ana Petrova', email: 'ana@example.com', cur: 'MKD', total: 14923000, min: 500 }, 'Game Store'),
    order({ id: 'w14', num: '#10493', name: 'Sara Nikolova', email: 'sara@example.com', cur: 'EUR', total: 16395, status: 'completed', ful: 'fulfilled', min: 600 }, 'Game Store'),
  ]
}

function worstItems(): Row[] {
  const many = Array.from({ length: 40 }, (_, i) => ({
    id: `wi${i}`, order_id: 'w1', position: i,
    sku: i === 3 ? null : `NW-HP-2026-${String(i).padStart(4, '0')}-CHARCOAL-MATTE-EU-PLUG-LIMITED-HOLIDAY`,
    name: i === 5 ? null : i % 4 === 0 ? LONG_ITEM : `Replacement part ${i + 1}`,
    quantity: i === 7 ? 12000 : (i % 3) + 1, unit_price_minor: i === 9 ? 99999999 : 1999 + i * 250,
  }))
  return [...many, { id: 'wi-b', order_id: 'w2', position: 0, sku: 'GC-50', name: 'Gift card 50', quantity: 1, unit_price_minor: 0 }]
}

function worstEvents(): Row[] {
  const events: Row[] = []
  for (let i = 0; i < 45; i += 1) {
    const mine = i % 5 === 2
    events.push({
      id: `we${i}`, order_id: 'w1', source: mine ? 'workrelay' : 'external', type: mine ? 'note.added' : i % 5 === 0 ? 'order.status_changed' : 'order.updated',
      occurred_at: ago(3 + i * 40), actor_user_id: mine ? 'u1' : null,
      data: mine ? { note: i === 2 ? LONG_NOTE : 'Called the customer, no answer.' } : { applied: ['status', 'totals', 'shipping_address', 'items'], status_to: 'processing' },
    })
  }
  return events
}

const worstIntegrations = (): Row[] => [
  { id: SHOP_1, organization_id: ORG, kind: 'commerce', name: LONG_STORE, status: 'connected', key_prefix: 'wr_live_c2e3', external_store_id: 'pazarmax-production-eu-west-1-store-0042', external_base_url: 'https://www.pazarmax-official-online-storefront.example.com/api/v2/webhooks/workrelay', bound_at: ago(110), last_seen_at: ago(1), created_at: ago(150) },
  { id: SHOP_2, organization_id: ORG, kind: 'commerce', name: 'Game Store 2', status: 'awaiting_bind', key_prefix: 'wr_live_9a10', external_store_id: null, external_base_url: null, bound_at: null, last_seen_at: null, created_at: ago(20) },
  { id: 'i3', organization_id: ORG, kind: 'commerce', name: 'Pop-up store (revoked)', status: 'revoked', key_prefix: 'wr_live_41ff', external_store_id: 'popup-skopje', external_base_url: null, bound_at: ago(9000), last_seen_at: ago(60 * 24 * 40), created_at: ago(9500) },
  { id: 'i4', organization_id: ORG, kind: 'commerce', name: 'J', status: 'connected', key_prefix: 'wr_live_0001', external_store_id: 'j', external_base_url: null, bound_at: ago(90), last_seen_at: ago(60 * 24 * 3), created_at: ago(120) },
]

const worstWorkflows = (): Row[] => [
  { id: 'w1', organization_id: ORG, name: LONG_AUTOMATION, preset: 'notify', preset_config: { event: 'created', channel: 'discord', url: 'https://discord.com/api/webhooks/1190000000000000000/aVeryLongWebhookTokenThatHasNoSpacesInItAndKeepsGoing_aVeryLongWebhookTokenThatHasNoSpacesInIt' }, enabled: true, status: 'published', current_version_id: 'v1', updated_at: ago(27), created_at: ago(30) },
  { id: 'w2', organization_id: ORG, name: 'Review orders above 1,250,000', preset: 'review_large', preset_config: { threshold: 1250000, reviewer_role: 'admin' }, enabled: false, status: 'published', current_version_id: 'v2', updated_at: ago(500), created_at: ago(600) },
  { id: 'w3', organization_id: ORG, name: 'A', preset: 'notify', preset_config: { event: 'cancelled', channel: 'slack', url: 'https://hooks.slack.com/services/T0/B0/x' }, enabled: true, status: 'published', current_version_id: 'v3', updated_at: ago(5), created_at: ago(9) },
]

const LONG_ERROR = 'HTTP 500: upstream connect error or disconnect/reset before headers. reset reason: connection termination while calling https://discord.com/api/webhooks/1190000000000000000/aVeryLongWebhookTokenThatHasNoSpacesInIt'

function worstRuns(): Row[] {
  const spec: [string, number, number | null, number, string | null][] = [
    ['succeeded', 1, 0.2, 1, null], ['failed', 12, 0.8, 5, LONG_ERROR], ['running', 2, null, 1, null], ['waiting_approval', 5, null, 1, null],
    ['succeeded', 70, 4320, 1, null], ['failed', 90, 1.1, 3, 'HTTP 404'], ['succeeded', 600, 0.5, 1, null],
  ]
  return spec.map(([status, min, dur, attempt, error], i) => ({
    id: `wr${i}`, status, organization_id: ORG, workflow_id: i % 2 ? 'w2' : 'w1', version_id: 'v1', trigger_source: 'order_created', event_id: `evt_01HZX9K3Q8V5N2M7T4R6B1C0D9_order.created_retry_attempt_${i}_from_edge_node_fra1`,
    attempt, error,
    started_at: ago(min), finished_at: dur ? new Date(Date.now() - min * 60_000 + dur * 1000).toISOString() : null, created_at: ago(min),
    workflows: { name: i % 2 ? 'Review orders above 1,250,000' : LONG_AUTOMATION }, workflow_versions: { version: i === 0 ? 128 : 1 },
  }))
}

const worstSteps = (): Row[] => [
  { id: 'ws1', run_id: 'wr1', step_key: 'notify', step_name: 'Notify the fulfilment team on Discord with the full order summary', step_type: 'http_request', position: 0, status: 'failed',
    input: { method: 'POST', url: 'https://discord.com/[redacted]', headers: { 'content-type': 'application/json', 'x-request-id': 'a3b7c9d1-e5f7-4a1b-8c2d-9e0f1a2b3c4d' }, body: { content: `New order ${LONG_ORDER_NO} for ${LONG_EMAIL} totalling 12,345,678.90 EUR`, items: Array.from({ length: 24 }, (_, i) => ({ sku: `NW-HP-2026-${i}`, name: LONG_ITEM, qty: i + 1 })) } },
    output: { status: 500, body: LONG_ERROR }, error: LONG_ERROR, attempt: 5, started_at: ago(12), finished_at: ago(11.9) },
]

const worstEventsLog = (): Row[] =>
  [
    ['order.fulfillment_status_changed', 'evt_01HZX9K3Q8V5N2M7T4R6B1C0D9_order.created_retry_attempt_3_from_edge_node_fra1', 'processed', null, 1],
    ['order.created', 'bad-1', 'failed', 'order.items[17].unit_price_minor: Invalid input: expected number, received string; order.customer.email: Invalid email address; order.totals.total_minor: expected int, received float', 90],
    ['order.created', 'ign-1', 'ignored', 'unsupported event_type', 120],
    ['order.status_changed', 'evt_OMNI_855383_status', 'processed', null, 11],
  ].map(([t, id, status, error, min], i) => ({ id: `we-${i}`, integration_id: SHOP_1, event_id: id, event_type: t, status, error, attempt_count: 0, received_at: ago(min as number), processed_at: ago(min as number), organization_id: ORG }))

const LONG_COMMENT = 'Approved after speaking with the customer by phone. They confirmed the delivery address and the replacement reason. ' + 'Please make sure the courier is told to call ahead, because the building has no doorbell. '.repeat(20)

const worstApprovals = (): Row[] => [
  { id: 'a1', run_id: 'wr3', step_key: 'review', title: `Review large order ${LONG_ORDER_NO} (12345678.90 EUR)`, context: {}, reviewer_user_id: null, reviewer_role: 'admin', status: 'pending', decided_by: null, decided_at: null, comment: null, created_at: ago(5), organization_id: ORG },
  { id: 'a2', run_id: 'wr0', step_key: 'review', title: 'Review large order #10490 (2500000000.00 IDR)', context: {}, reviewer_user_id: null, reviewer_role: 'admin', status: 'approved', decided_by: 'u1', decided_at: ago(30), comment: LONG_COMMENT, created_at: ago(40), organization_id: ORG },
  { id: 'a3', run_id: 'wr0', step_key: 'review', title: 'Review large order #1', context: {}, reviewer_user_id: null, reviewer_role: 'admin', status: 'rejected', decided_by: 'u1', decided_at: ago(50), comment: 'No', created_at: ago(60), organization_id: ORG },
]

const NAMES = ['Ana Petrova', 'Marko Ilievski', 'Sara Nikolova', 'Ivan Todorov', 'Elena Stojanova', 'Nikola Dimitrov', 'Maja Trajkovska', 'Stefan Angelov']
function manyOrders(n: number): Row[] {
  const statuses = ['pending', 'processing', 'completed', 'completed', 'cancelled']
  return Array.from({ length: n }, (_, i) => {
    const s = statuses[i % statuses.length]
    return order({ id: `m${i}`, num: `#${1042 + i}`, name: NAMES[i % NAMES.length], email: `${NAMES[i % NAMES.length].toLowerCase().replace(' ', '.')}@example.com`, cur: ['EUR', 'USD', 'MKD'][i % 3], total: 4999 + ((i * 7919) % 90000), status: s, pay: s === 'cancelled' ? 'refunded' : 'paid', ful: s === 'completed' ? 'fulfilled' : 'unfulfilled', min: 2 + i * 9 }, 'Game Store')
  })
}

export function buildDataset(mode: Exclude<DataMode, 'demo'>, demoDb: Record<string, Row[]>, demoRpc: Record<string, unknown>): { DB: Record<string, Row[]>; RPC: Record<string, unknown> } {
  const keep = { memberships: demoDb.memberships }
  const members = (n: number, long: boolean) =>
    Array.from({ length: n }, (_, i) => ({ user_id: `u${i + 1}`, email: i === 0 ? 'owner@example.com' : long && i % 3 === 0 ? `${LONG_FOLK.replace('bartholomew', `bartholomew${i}`)}` : `member${i}@example.com`, role: i === 0 ? 'owner' : i % 7 === 0 ? 'admin' : 'member', created_at: ago(5000 - i * 10) }))

  if (mode === 'empty') {
    return {
      DB: { ...keep, orders: [], order_items: [], order_events: [], integrations: [], workflows: [], workflow_runs: [], step_runs: [], webhook_events: [], approvals: [] },
      RPC: { ...demoRpc, list_members: members(1, false) },
    }
  }
  if (mode === 'one') {
    const o = worstOrders()[13]
    return {
      DB: {
        ...keep, orders: [{ ...o, id: 'o1' }], order_items: [{ id: 'it1', order_id: 'o1', position: 0, sku: 'GC-50', name: 'Gift card 50', quantity: 1, unit_price_minor: 16395 }],
        order_events: [{ id: 'e1', order_id: 'o1', source: 'external', type: 'order.created', occurred_at: ago(1), actor_user_id: null, data: { applied: ['status', 'totals'], status_to: 'pending' } }],
        integrations: demoDb.integrations.slice(0, 1), workflows: demoDb.workflows.slice(0, 1), workflow_runs: demoDb.workflow_runs.slice(0, 1), step_runs: demoDb.step_runs,
        webhook_events: demoDb.webhook_events.slice(0, 1), approvals: demoDb.approvals.slice(0, 1),
      },
      RPC: { ...demoRpc, list_members: members(1, false) },
    }
  }
  if (mode === 'many') {
    const runs = Array.from({ length: 700 }, (_, i) => ({ ...demoDb.workflow_runs[i % 5], id: `mr${i}`, started_at: ago(5 + i * 6), created_at: ago(5 + i * 6) }))
    const events = Array.from({ length: 900 }, (_, i) => ({ ...demoDb.webhook_events[i % 5], id: `me${i}`, event_id: `evt_${1000 + i}`, received_at: ago(2 + i * 4) }))
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: `mi${i}`, order_id: 'm0', position: i, sku: `SKU-${String(i).padStart(4, '0')}`, name: `Catalogue item ${i + 1}`, quantity: (i % 4) + 1, unit_price_minor: 999 + i }))
    return {
      DB: {
        ...keep, orders: manyOrders(1200), order_items: items, order_events: Array.from({ length: 250 }, (_, i) => ({ id: `mev${i}`, order_id: 'm0', source: i % 4 === 1 ? 'workrelay' : 'external', type: i % 4 === 1 ? 'note.added' : 'order.updated', occurred_at: ago(2 + i * 30), actor_user_id: i % 4 === 1 ? 'u1' : null, data: i % 4 === 1 ? { note: `Note ${i}` } : { applied: ['status'], status_to: 'processing' } })),
        integrations: Array.from({ length: 30 }, (_, i) => ({ ...demoDb.integrations[i % 2], id: `mi${i}`, name: `Store ${i + 1}` })), workflows: Array.from({ length: 12 }, (_, i) => ({ ...demoDb.workflows[i % 2], id: `mw${i}`, name: `Automation ${i + 1}` })),
        workflow_runs: runs, step_runs: demoDb.step_runs, webhook_events: events, approvals: Array.from({ length: 120 }, (_, i) => ({ ...demoDb.approvals[i % 2], id: `ma${i}`, title: `Review large order #${1042 + i}` })),
      },
      RPC: { ...demoRpc, list_members: members(200, true) },
    }
  }
  return {
    DB: {
      ...keep, orders: worstOrders(), order_items: worstItems(), order_events: worstEvents(), integrations: worstIntegrations(), workflows: worstWorkflows(),
      workflow_runs: worstRuns(), step_runs: worstSteps(), webhook_events: worstEventsLog(), approvals: worstApprovals(),
    },
    RPC: { ...demoRpc, list_members: members(60, true) },
  }
}
