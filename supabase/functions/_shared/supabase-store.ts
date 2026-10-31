import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrderPlan, StoredOrder } from './normalize.ts'
import type { IngestStore } from './store.ts'

const UNIQUE_VIOLATION = '23505'

/** Service-role implementation. Only ever constructed inside Edge Functions. */
export function createSupabaseStore(db: SupabaseClient): IngestStore {
  return {
    async findIntegrationByKeyHash(hashHex) {
      const { data, error } = await db
        .from('integrations')
        .select('id, organization_id, status, external_store_id, track_signups')
        .eq('key_hash', `\\x${hashHex}`)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      return {
        id: data.id,
        organizationId: data.organization_id,
        status: data.status,
        externalStoreId: data.external_store_id,
        trackSignups: data.track_signups === true,
      }
    },

    async touchIntegration(id) {
      await db.from('integrations').update({ last_seen_at: new Date().toISOString() }).eq('id', id)
    },

    async bindIntegration(id, storeId, baseUrl) {
      const { data, error } = await db
        .from('integrations')
        .update({
          status: 'connected',
          external_store_id: storeId,
          external_base_url: baseUrl,
          bound_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'awaiting_bind')
        .select('id')
      if (error?.code === UNIQUE_VIOLATION) return 'store_in_use'
      if (error) throw new Error(error.message)
      return data && data.length > 0 ? 'bound' : 'not_awaiting'
    },

    async recordEvent(e) {
      const row = {
        organization_id: e.organizationId,
        integration_id: e.integrationId,
        event_id: e.eventId,
        event_type: e.eventType,
        raw_payload: e.rawPayload,
      }
      const inserted = await db.from('webhook_events').insert(row).select('id, status').single()
      if (!inserted.error) return { id: inserted.data.id, status: inserted.data.status, isNew: true }
      if (inserted.error.code !== UNIQUE_VIOLATION) throw new Error(inserted.error.message)

      const { data, error } = await db
        .from('webhook_events')
        .select('id, status, attempt_count, error')
        .eq('integration_id', e.integrationId)
        .eq('event_id', e.eventId)
        .single()
      if (error) throw new Error(error.message)
      // Failed and half-finished events are retried. So is a signup that was ignored only because tracking was off:
      // once the shop switches it on, resending the same event works.
      const retry = data.status === 'failed' || data.status === 'received' || (data.status === 'ignored' && String(data.error ?? '').startsWith('signups_off'))
      if (retry) {
        await db
          .from('webhook_events')
          .update({ attempt_count: data.attempt_count + 1, raw_payload: e.rawPayload, status: 'received', error: null })
          .eq('id', data.id)
      }
      return { id: data.id, status: retry ? 'received' : data.status, isNew: false }
    },

    async markEvent(id, status, error) {
      await db
        .from('webhook_events')
        .update({ status, error: error ?? null, processed_at: new Date().toISOString() })
        .eq('id', id)
    },

    async getOrder(integrationId, externalId) {
      const { data, error } = await db
        .from('orders')
        .select('*')
        .eq('integration_id', integrationId)
        .eq('external_id', externalId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data as StoredOrder | null) ?? null
    },

    async applySignup(a) {
      const { data, error } = await db.rpc('apply_customer_signup', {
        p_event_row: a.eventRowId,
        p_org: a.organizationId,
        p_integration: a.integrationId,
        p_event_type: a.eventType,
        p_occurred_at: a.occurredAt,
        p_email: a.email,
        p_name: a.name,
        p_phone: a.phone,
        p_external_id: a.externalId,
        p_registered_at: a.registeredAt,
      })
      if (error) throw new Error(error.message)
      return data === 'ok' ? 'ok' : 'disabled'
    },

    async applyProducts(a) {
      const { data, error } = await db.rpc('apply_product_sync', {
        p_integration: a.integrationId,
        p_items: a.items,
        p_source: a.source,
        p_at: a.at,
      })
      if (error) throw new Error(error.message)
      return typeof data === 'number' ? data : 0
    },

    async recordProductPush(a) {
      const { error } = await db.rpc('record_product_push', { p_integration: a.integrationId, p_name: a.byName, p_role: a.byRole })
      if (error) throw new Error(error.message)
    },

    async announceProductSync(a) {
      const { error } = await db.rpc('announce_products_synced', {
        p_integration: a.integrationId, p_name: a.byName, p_role: a.byRole, p_products: a.products,
      })
      if (error) throw new Error(error.message)
    },

    async applyPlan({ eventRowId, organizationId, integrationId, externalId, plan }: {
      eventRowId: string
      organizationId: string
      integrationId: string
      externalId: string
      plan: OrderPlan
    }) {
      const { data, error } = await db.rpc('apply_order_plan', {
        p_event_row: eventRowId,
        p_org: organizationId,
        p_integration: integrationId,
        p_external_id: externalId,
        p_expected_version: plan.expectedVersion,
        p_order: plan.fields,
        p_items: plan.items,
        p_timeline: plan.timeline,
      })
      if (error) throw new Error(error.message)
      return data === 'ok' ? 'ok' : 'conflict'
    },
  }
}
