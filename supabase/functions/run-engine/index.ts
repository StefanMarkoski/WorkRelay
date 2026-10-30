import { createClient } from '@supabase/supabase-js'
import { tick } from '../_shared/engine.ts'
import { json } from '../_shared/keys.ts'
import { consoleLogger } from '../_shared/log.ts'
import { pullDueProducts } from '../_shared/product-pull.ts'
import { createEngineStore } from './engine-store.ts'
import { createHttpClient } from './http-client.ts'
import { createPullClient } from '../_shared/pull-client.ts'
import { createPullStore } from '../_shared/pull-store.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const pullDeps = { store: createPullStore(db), http: createPullClient(), log: consoleLogger }
const deps = { store: createEngineStore(db), http: createHttpClient(), log: consoleLogger }

// Called by pg_cron (via pg_net) every few seconds. Each call is one short, bounded tick.
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
  // The secret lives in Supabase Vault; the database does the comparison.
  const { data: authorized, error: authError } = await db.rpc('verify_engine_secret', {
    p_secret: req.headers.get('x-engine-secret') ?? '',
  })
  if (authError || authorized !== true) return json(401, { error: 'unauthorized' })
  try {
    // Due product pulls ride on the same tick; a failing pull must never stop the automations from running.
    const [result, pulls] = await Promise.all([
      tick(deps),
      pullDueProducts(pullDeps).catch((err) => {
        consoleLogger.error('product pull failed', { message: err instanceof Error ? err.message : 'unknown' })
        return { pulled: 0, failed: 0 }
      }),
    ])
    return json(200, { ...(result as unknown as Record<string, unknown>), product_pulls: pulls })
  } catch (err) {
    consoleLogger.error('engine tick failed', { message: err instanceof Error ? err.message : 'unknown' })
    return json(500, { error: 'tick_failed' })
  }
})
