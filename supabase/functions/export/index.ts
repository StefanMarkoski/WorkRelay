import { createClient } from '@supabase/supabase-js'
import { handleExport } from '../_shared/export-api.ts'
import { createExportStore } from '../_shared/export-store.ts'
import { consoleLogger } from '../_shared/log.ts'
import { createSupabaseStore } from '../_shared/supabase-store.ts'

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})
const deps = { store: createSupabaseStore(db), exports: createExportStore(db), log: consoleLogger }

Deno.serve((req) => handleExport(req, deps))
