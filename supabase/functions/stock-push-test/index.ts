import { createClient } from '@supabase/supabase-js'
import { getCaller } from '../_shared/auth.ts'
import { json } from '../_shared/keys.ts'
import { consoleLogger } from '../_shared/log.ts'
import { createPushClient } from '../_shared/push-client.ts'
import { createPushStore } from '../_shared/stock-push-store.ts'
import { handleStockPushTest } from '../_shared/stock-push.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const deps = { getCaller: (req: Request) => getCaller(req, admin), store: createPushStore(admin), http: createPushClient(), log: consoleLogger }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const res = await handleStockPushTest(req, deps).catch((err) => {
    consoleLogger.error('stock push test failed', { message: err instanceof Error ? err.message : 'unknown' })
    return json(500, { error: 'internal_error' })
  })
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})
