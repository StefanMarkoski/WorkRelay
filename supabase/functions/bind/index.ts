import { createClient } from '@supabase/supabase-js'
import { handleBind } from '../_shared/ingest.ts'
import { consoleLogger } from '../_shared/log.ts'
import { createSupabaseStore } from '../_shared/supabase-store.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const store = createSupabaseStore(db)

Deno.serve((req) => handleBind(req, { store, log: consoleLogger }))
