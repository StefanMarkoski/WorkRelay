import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClaimedPush, PushItem, PushStore, TestClaim } from './stock-push.ts'

/** Service-role implementation of the write-back persistence. Every decision is made by the database functions. */
export function createPushStore(db: SupabaseClient): PushStore {
  return {
    async claim() {
      const { data, error } = await db.rpc('claim_stock_pushes')
      if (error) throw new Error(error.message)
      return (data ?? []).map(
        (r: { request_id: string; integration_id: string; store_id: string | null; url: string; secret: string; items: PushItem[] }): ClaimedPush => ({
          requestId: r.request_id, integrationId: r.integration_id, storeId: r.store_id, url: r.url, secret: r.secret, items: r.items,
        }),
      )
    },
    async stillAllowed(requestId) {
      const { data, error } = await db.rpc('stock_push_still_allowed', { p_request: requestId })
      if (error) throw new Error(error.message)
      return data === true
    },
    async complete(requestId, ok, httpStatus, err) {
      const { error } = await db.rpc('complete_stock_push', { p_request: requestId, p_ok: ok, p_http: httpStatus, p_error: err })
      if (error) throw new Error(error.message)
    },
    async beginTest(userId, integrationId): Promise<TestClaim> {
      const { data, error } = await db.rpc('begin_stock_push_test', { p_user: userId, p_integration: integrationId })
      if (error) throw new Error(error.message)
      const row = (data ?? [])[0] as { request_id: string; store_id: string | null; url: string; secret: string; challenge: string } | undefined
      if (!row) throw new Error('no_url')
      return { requestId: row.request_id, storeId: row.store_id, url: row.url, secret: row.secret, challenge: row.challenge }
    },
    async finishTest(requestId, ok, httpStatus, err) {
      const { error } = await db.rpc('finish_stock_push_test', { p_request: requestId, p_ok: ok, p_http: httpStatus, p_error: err })
      if (error) throw new Error(error.message)
    },
  }
}
