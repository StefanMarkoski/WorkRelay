import { z } from 'zod'
import { eventTimestamp, timestamp } from './timestamp.ts'

/**
 * Inbound order webhook contract. Strict on identity, lenient on content:
 * the envelope and `order.external_id` are required, everything else is optional.
 * Absent = unknown/unchanged. Explicit null = clear the field. Unknown keys are stripped
 * here (the raw payload is stored separately).
 *
 * The organization and store are NEVER read from the payload; they come from the signing key.
 */

const optional = <T extends z.ZodType>(schema: T) => schema.nullish()

const minor = z.number().int().safe() // integer minor units (cents)
/** An amount of money is never below zero: a refund is a payment status, not a negative total. */
const money = minor.min(0)
const currency = z.string().regex(/^[A-Za-z]{3}$/).transform((v) => v.toUpperCase())

export const ORDER_STATUSES = ['pending', 'processing', 'completed', 'cancelled', 'unknown'] as const
export const PAYMENT_STATUSES = ['unpaid', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed', 'unknown'] as const
export const FULFILLMENT_STATUSES = ['unfulfilled', 'partial', 'fulfilled', 'returned', 'unknown'] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number]

/** Unknown status strings are kept as-is; the normalizer maps them to 'unknown'. */
const rawStatus = z.string().min(1).max(64)

export const addressSchema = z.object({
  name: optional(z.string().max(200)),
  line1: optional(z.string().max(300)),
  line2: optional(z.string().max(300)),
  city: optional(z.string().max(120)),
  region: optional(z.string().max(120)),
  postal_code: optional(z.string().max(32)),
  country: optional(z.string().max(64)),
  phone: optional(z.string().max(64)),
})

export const orderItemSchema = z.object({
  external_id: optional(z.string().max(200)),
  sku: optional(z.string().max(200)),
  name: optional(z.string().max(500)),
  quantity: optional(z.number().int().min(0).max(1_000_000)),
  unit_price_minor: optional(money),
})

export const orderSchema = z.object({
  external_id: z.string().min(1).max(200), // required: order identity
  order_number: optional(z.string().max(100)),
  placed_at: optional(timestamp),
  currency: optional(currency),
  customer: optional(
    z.object({
      name: optional(z.string().max(200)),
      email: optional(z.email().max(320)),
      phone: optional(z.string().max(64)),
    }),
  ),
  totals: optional(
    z.object({
      subtotal_minor: optional(money),
      discount_minor: optional(money),
      shipping_minor: optional(money),
      tax_minor: optional(money),
      total_minor: optional(money),
    }),
  ),
  status: optional(rawStatus),
  payment_status: optional(rawStatus),
  fulfillment_status: optional(rawStatus),
  billing_address: optional(addressSchema),
  shipping_address: optional(addressSchema),
  items: optional(z.array(orderItemSchema).max(1000)), // when present, replaces the item list
  notes: optional(z.string().max(5000)),
})

export const ORDER_EVENT_TYPES = ['order.created', 'order.updated', 'order.status_changed'] as const

export const orderWebhookSchema = z.object({
  event_id: z.string().min(1).max(200), // required: idempotency
  event_type: z.string().min(1).max(100), // required; unsupported types are recorded as 'ignored'
  occurred_at: eventTimestamp, // required: ordering; within the last 7 days
  order: orderSchema,
})

export type OrderWebhook = z.infer<typeof orderWebhookSchema>
export type OrderPayload = z.infer<typeof orderSchema>
