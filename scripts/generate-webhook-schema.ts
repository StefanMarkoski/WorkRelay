// Regenerates documentation/order-webhook.schema.json from the validator the server uses.
//   node scripts/generate-webhook-schema.ts
import { writeFileSync } from 'node:fs'
import { z } from 'zod'
import { orderWebhookSchema } from '../supabase/functions/_shared/order-contract.ts'

const schema = z.toJSONSchema(orderWebhookSchema, { io: 'input', unrepresentable: 'any' })
writeFileSync(
  new URL('../documentation/order-webhook.schema.json', import.meta.url),
  JSON.stringify({ title: 'WorkRelay order webhook event', ...schema }, null, 2) + '\n',
)
console.log('wrote documentation/order-webhook.schema.json')
