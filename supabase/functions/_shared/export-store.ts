import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExportStore } from './export-api.ts'

/** Service-role implementation over the export_* SQL functions (0052). */
export function createExportStore(db: SupabaseClient): ExportStore {
  return {
    async begin(integrationId, requestId, resource) {
      const { data, error } = await db.rpc('export_begin', { p_integration: integrationId, p_request_id: requestId, p_resource: resource })
      if (error) throw new Error(error.message)
      const row = Array.isArray(data) ? data[0] : data
      if (!row?.ok) return { ok: false, reason: row?.reason ?? 'not_connected' }
      return { ok: true, callId: row.call_id, secret: row.secret }
    },
    async finish(callId, status, reason, rows) {
      const { error } = await db.rpc('export_finish', { p_call: callId, p_status: status, p_reason: reason, p_rows: rows })
      if (error) throw new Error(error.message)
    },
    async page(integrationId, resource, q) {
      const { data, error } = await db.rpc('export_page', {
        p_integration: integrationId,
        p_resource: resource,
        p_since: q.since,
        p_after_at: q.after?.at ?? null,
        p_after_id: q.after?.id ?? null,
        p_limit: q.limit,
      })
      if (error) throw new Error(error.message)
      return { items: data?.items ?? [], next: data?.next ?? null }
    },
  }
}
