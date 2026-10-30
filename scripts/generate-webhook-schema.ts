// Regenerates documentation/order-webhook.schema.json, customer-webhook.schema.json and product-feed.schema.json from the
// validators the server uses.
//   node scripts/generate-webhook-schema.ts
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { customerWebhookSchema } from '../supabase/functions/_shared/customer-contract.ts'
import { PULL_MAX_PRODUCTS, inventoryEnvelope } from '../supabase/functions/_shared/inventory-contract.ts'
import { orderWebhookSchema } from '../supabase/functions/_shared/order-contract.ts'

const write = (file: string, title: string, schema: z.ZodType) => {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  writeFileSync(new URL(`../documentation/${file}`, import.meta.url), JSON.stringify({ title, ...json }, null, 2) + '\n')
  console.log(`wrote documentation/${file}`)
}
write('order-webhook.schema.json', 'WorkRelay order webhook event', orderWebhookSchema)
write('customer-webhook.schema.json', 'WorkRelay customer webhook event', customerWebhookSchema)
write('product-feed.schema.json', 'WorkRelay product feed (push body and pull answer)', inventoryEnvelope(PULL_MAX_PRODUCTS))
