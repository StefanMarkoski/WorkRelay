import { z } from 'zod'

/**
 * Product and stock feed. The same shape is used two ways: a shop pushes it to /inventory-webhook, and WorkRelay
 * receives it as the response of the shop's own endpoint when it pulls on its schedule.
 * Only `sku` is required; every other field is optional and null/absent means "leave what is stored unchanged".
 * Unknown fields are ignored, so a shop can send its own extras without breaking anything.
 */

const optional = <T extends z.ZodType>(schema: T) => schema.nullish()
const timestamp = z.iso.datetime({ offset: true })

export const productSchema = z
  .object({
    sku: z.string().trim().min(1).max(200), // required: how a product is identified within a shop
    name: optional(z.string().trim().max(300)),
    stock: optional(z.number().int().min(-1_000_000_000).max(1_000_000_000)), // pieces on hand; shops may allow negatives
    notify_on: optional(z.number().int().min(0).max(1_000_000_000)), // the shop's own low-stock threshold
    price_minor: optional(z.number().int().min(0)), // smallest currency unit, like orders
    currency: optional(z.string().regex(/^[A-Za-z]{3}$/)),
    unit: optional(z.string().max(50)),
    category: optional(z.string().max(200)),
    barcode: optional(z.string().max(100)),
    updated_at: optional(timestamp), // when the shop last changed this product; defaults to when the report was made
  })
  .refine((p) => p.price_minor == null || p.currency != null, { message: 'currency is required with price_minor', path: ['currency'] })

export type ProductItem = z.infer<typeof productSchema>

export const PUSH_MAX_PRODUCTS = 500
export const PULL_MAX_PRODUCTS = 5000

/** Who pressed the sync button in the shop's admin, so the team's notification can say so. Both parts are optional. */
export const syncedBySchema = z.object({
  name: optional(z.string().trim().max(120)),
  role: optional(z.string().trim().max(60)),
})

/**
 * The feed. `synced_by` and `quiet` only mean something on a push: `synced_by` names the person who pressed the shop's sync
 * button, and `quiet: true` marks an automatic background push that should not notify anyone. A pull answer may carry them
 * and they are ignored.
 */
export const inventoryEnvelope = (max: number) =>
  z.object({ products: z.array(productSchema).max(max), synced_by: optional(syncedBySchema), quiet: optional(z.boolean()) })

/** The shape handed to the database: nulls dropped, times normalised, so "absent" is the only way to say "unchanged". */
export function toDatabaseItems(items: ProductItem[]): Record<string, unknown>[] {
  return items.map((p) => {
    const out: Record<string, unknown> = { sku: p.sku }
    if (p.name) out.name = p.name
    if (p.stock != null) out.stock = p.stock
    if (p.notify_on != null) out.notify_on = p.notify_on
    if (p.price_minor != null) {
      out.price_minor = p.price_minor
      out.currency = p.currency
    }
    if (p.unit) out.unit = p.unit
    if (p.category) out.category = p.category
    if (p.barcode) out.barcode = p.barcode
    if (p.updated_at) out.updated_at = new Date(p.updated_at).toISOString()
    return out
  })
}
