import type { OrderWebhook, OrderStatus, PaymentStatus, FulfillmentStatus } from './order-contract.ts'

type Address = Record<string, string | null | undefined>

export interface OrderFields {
  order_number: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  placed_at: string | null
  currency: string | null
  subtotal_minor: number | null
  discount_minor: number | null
  shipping_minor: number | null
  tax_minor: number | null
  total_minor: number | null
  status: OrderStatus
  payment_status: PaymentStatus
  fulfillment_status: FulfillmentStatus
  external_status: string | null
  external_payment_status: string | null
  external_fulfillment_status: string | null
  billing_address: Address | null
  shipping_address: Address | null
  notes: string | null
  data_quality: string[]
  /** Payload key -> occurred_at of the last event applied to it. */
  applied_at: Record<string, string>
  last_event_at: string
}

export interface StoredOrder extends OrderFields {
  version: number
}

export interface ItemRow {
  position: number
  external_id: string | null
  sku: string | null
  name: string | null
  quantity: number | null
  unit_price_minor: number | null
}

export interface OrderPlan {
  fields: OrderFields
  /** null = items untouched by this event. */
  items: ItemRow[] | null
  timeline: { type: string; occurred_at: string; data: Record<string, unknown> }
  /** Version the plan was computed from; null when the order did not exist. */
  expectedVersion: number | null
}

// Mapping tables are a best-effort starting point; anything unmatched becomes 'unknown'
// and the original string is kept in external_*.
const ORDER_MAP: Record<string, OrderStatus> = {
  pending: 'pending', new: 'pending', open: 'pending', awaiting_payment: 'pending',
  processing: 'processing', confirmed: 'processing', in_progress: 'processing',
  completed: 'completed', complete: 'completed', delivered: 'completed', closed: 'completed',
  cancelled: 'cancelled', canceled: 'cancelled', void: 'cancelled',
}
const PAYMENT_MAP: Record<string, PaymentStatus> = {
  unpaid: 'unpaid', pending: 'unpaid', authorized: 'authorized',
  paid: 'paid', captured: 'paid', succeeded: 'paid',
  partially_refunded: 'partially_refunded', refunded: 'refunded',
  failed: 'failed', declined: 'failed',
}
const FULFILLMENT_MAP: Record<string, FulfillmentStatus> = {
  unfulfilled: 'unfulfilled', pending: 'unfulfilled', not_shipped: 'unfulfilled',
  partial: 'partial', partially_fulfilled: 'partial',
  fulfilled: 'fulfilled', shipped: 'fulfilled', delivered: 'fulfilled',
  returned: 'returned',
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
export const mapOrderStatus = (v?: string | null): OrderStatus => ORDER_MAP[norm(v)] ?? 'unknown'
export const mapPaymentStatus = (v?: string | null): PaymentStatus => PAYMENT_MAP[norm(v)] ?? 'unknown'
export const mapFulfillmentStatus = (v?: string | null): FulfillmentStatus => FULFILLMENT_MAP[norm(v)] ?? 'unknown'

const iso = (v: string | null | undefined) => (v ? new Date(v).toISOString() : null)

function emptyFields(lastEventAt: string): OrderFields {
  return {
    order_number: null, customer_name: null, customer_email: null, customer_phone: null,
    placed_at: null, currency: null, subtotal_minor: null, discount_minor: null,
    shipping_minor: null, tax_minor: null, total_minor: null,
    status: 'unknown', payment_status: 'unknown', fulfillment_status: 'unknown',
    external_status: null, external_payment_status: null, external_fulfillment_status: null,
    billing_address: null, shipping_address: null, notes: null,
    data_quality: [], applied_at: {}, last_event_at: lastEventAt,
  }
}

/**
 * Merge an event into the current order state.
 * - absent key: unchanged; explicit null: cleared
 * - a payload key is skipped (stale) if a newer event already set it
 */
export function planOrderUpdate(existing: StoredOrder | null, ev: OrderWebhook): OrderPlan {
  const at = new Date(ev.occurred_at).toISOString()
  const { version: _v, ...stored } = existing ?? { ...emptyFields(at), version: 0 }
  const f: OrderFields = { ...stored, applied_at: { ...stored.applied_at } }
  const o = ev.order
  const applied: string[] = []
  const stale: string[] = []

  const take = (key: string, present: boolean): boolean => {
    if (!present) return false
    const prev = f.applied_at[key]
    if (prev && Date.parse(prev) > Date.parse(at)) {
      stale.push(key)
      return false
    }
    f.applied_at[key] = at
    applied.push(key)
    return true
  }

  if (take('order_number', o.order_number !== undefined)) f.order_number = o.order_number ?? null
  if (take('placed_at', o.placed_at !== undefined)) f.placed_at = iso(o.placed_at)
  if (take('currency', o.currency !== undefined)) f.currency = o.currency ?? null
  if (take('notes', o.notes !== undefined)) f.notes = o.notes ?? null

  if (take('customer', o.customer !== undefined)) {
    const c = o.customer
    if (c === null) {
      f.customer_name = f.customer_email = f.customer_phone = null
    } else if (c) {
      if (c.name !== undefined) f.customer_name = c.name
      if (c.email !== undefined) f.customer_email = c.email
      if (c.phone !== undefined) f.customer_phone = c.phone
    }
  }

  if (take('totals', o.totals !== undefined)) {
    const t = o.totals
    if (t === null) {
      f.subtotal_minor = f.discount_minor = f.shipping_minor = f.tax_minor = f.total_minor = null
    } else if (t) {
      if (t.subtotal_minor !== undefined) f.subtotal_minor = t.subtotal_minor
      if (t.discount_minor !== undefined) f.discount_minor = t.discount_minor
      if (t.shipping_minor !== undefined) f.shipping_minor = t.shipping_minor
      if (t.tax_minor !== undefined) f.tax_minor = t.tax_minor
      if (t.total_minor !== undefined) f.total_minor = t.total_minor
    }
  }

  if (take('status', o.status !== undefined)) {
    f.external_status = o.status ?? null
    f.status = mapOrderStatus(o.status)
  }
  if (take('payment_status', o.payment_status !== undefined)) {
    f.external_payment_status = o.payment_status ?? null
    f.payment_status = mapPaymentStatus(o.payment_status)
  }
  if (take('fulfillment_status', o.fulfillment_status !== undefined)) {
    f.external_fulfillment_status = o.fulfillment_status ?? null
    f.fulfillment_status = mapFulfillmentStatus(o.fulfillment_status)
  }
  if (take('billing_address', o.billing_address !== undefined)) f.billing_address = o.billing_address ?? null
  if (take('shipping_address', o.shipping_address !== undefined)) f.shipping_address = o.shipping_address ?? null

  let items: ItemRow[] | null = null
  if (take('items', o.items !== undefined)) {
    items = (o.items ?? []).map((it, position) => ({
      position,
      external_id: it.external_id ?? null,
      sku: it.sku ?? null,
      name: it.name ?? null,
      quantity: it.quantity ?? null,
      unit_price_minor: it.unit_price_minor ?? null,
    }))
  }

  if (Date.parse(at) > Date.parse(f.last_event_at) || !existing) f.last_event_at = at

  const hadItems = existing ? !existing.data_quality.includes('no_items') && existing.applied_at.items !== undefined : false
  const hasItems = items !== null ? items.length > 0 : hadItems
  f.data_quality = computeQuality(f, hasItems)

  return {
    fields: f,
    items,
    expectedVersion: existing ? existing.version : null,
    timeline: {
      type: ev.event_type,
      occurred_at: at,
      data: {
        event_id: ev.event_id,
        applied,
        stale,
        ...(applied.includes('status') ? { status_from: existing?.status ?? null, status_to: f.status } : {}),
      },
    },
  }
}

function computeQuality(f: OrderFields, hasItems: boolean): string[] {
  const flags: string[] = []
  const money = [f.subtotal_minor, f.discount_minor, f.shipping_minor, f.tax_minor, f.total_minor]
  if (money.some((m) => m !== null) && !f.currency) flags.push('missing_currency')
  if (f.total_minor === null) flags.push('missing_total')
  if (!hasItems) flags.push('no_items')
  if (!f.customer_email && !f.customer_phone) flags.push('no_customer_contact')
  return flags
}
