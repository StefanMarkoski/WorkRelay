import { z } from 'zod'

/**
 * Optional inbound customer webhook (/customer-webhook). Strict on identity, lenient on content:
 * the envelope and `customer.email` are required, everything else is optional. Absent or null = leave unchanged.
 * The workspace and store come from the signing key, never from the payload. Email is the only identity:
 * `external_id` is stored and shown but never used to match customers.
 */

const optional = <T extends z.ZodType>(schema: T) => schema.nullish()
const timestamp = z.iso.datetime({ offset: true })

export const CUSTOMER_EVENT_TYPES = ['customer.created', 'customer.updated'] as const
export type CustomerEventType = (typeof CUSTOMER_EVENT_TYPES)[number]

export const customerSchema = z.object({
  email: z.email().max(320), // required: how customers are matched
  name: optional(z.string().max(200)),
  phone: optional(z.string().max(64)),
  external_id: optional(z.string().max(200)),
  registered_at: optional(timestamp), // when the account was created in the shop; defaults to occurred_at
})

export const customerWebhookSchema = z.object({
  event_id: z.string().min(1).max(200), // required: idempotency
  event_type: z.enum(CUSTOMER_EVENT_TYPES), // unsupported types are recorded as 'ignored' before this runs
  occurred_at: timestamp, // required: ordering
  customer: customerSchema,
})

export type CustomerWebhook = z.infer<typeof customerWebhookSchema>
