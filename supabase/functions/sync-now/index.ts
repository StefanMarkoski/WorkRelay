import { createClient } from '@supabase/supabase-js'
import { getCaller } from '../_shared/auth.ts'
import { json } from '../_shared/keys.ts'
import { consoleLogger } from '../_shared/log.ts'
import { createPullClient } from '../_shared/pull-client.ts'
import { createPullStore } from '../_shared/pull-store.ts'
import { handleSyncNow } from '../_shared/sync-now.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const deps = {
  getCaller: (req: Request) => getCaller(req, admin),
  async claim(userId: string, integrationId: string) {
    const { data, error } = await admin.rpc('claim_manual_product_sync', { p_user: userId, p_integration: integrationId })
    if (error) throw new Error(error.message)
    const row = (data ?? [])[0] as { source_url: string; auth_header: string | null; calls_left: number } | undefined
    if (!row) throw new Error('no_url')
    return { sourceUrl: row.source_url, authHeader: row.auth_header, callsLeft: row.calls_left }
  },
  pull: { store: createPullStore(admin), http: createPullClient(), log: consoleLogger },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const res = await handleSyncNow(req, deps).catch((err) => {
    consoleLogger.error('sync now failed', { message: err instanceof Error ? err.message : 'unknown' })
    return json(500, { error: 'internal_error' })
  })
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
})
