import type { SupabaseClient } from '@supabase/supabase-js'
import type { PullStore } from './product-pull.ts'

/** Service-role implementation of the scheduled pull's persistence. */
export function createPullStore(db: SupabaseClient): PullStore {
  return {
    async claimDue(limit) {
      const { data, error } = await db.rpc('claim_due_product_syncs', { p_limit: limit })
      if (error) throw new Error(error.message)
      return (data ?? []).map((r: { integration_id: string; source_url: string; auth_header: string | null }) => ({
        integrationId: r.integration_id,
        sourceUrl: r.source_url,
        authHeader: r.auth_header,
      }))
    },
    async apply(a) {
      const { data, error } = await db.rpc('apply_product_sync', {
        p_integration: a.integrationId,
        p_items: a.items,
        p_source: 'pull',
        p_at: a.at,
      })
      if (error) throw new Error(error.message)
      return typeof data === 'number' ? data : 0
    },
    async record(integrationId, message, count) {
      const { error } = await db.rpc('record_product_sync', { p_integration: integrationId, p_error: message, p_count: count ?? null })
      if (error) throw new Error(error.message)
    },
  }
}
