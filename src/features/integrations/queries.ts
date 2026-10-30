import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'

export const INTEGRATION_COLUMNS =
  'id, organization_id, kind, name, status, key_prefix, external_store_id, external_base_url, bound_at, last_seen_at, created_at, track_signups, signups_enabled_at, currency'

/** `poll`: refresh every 5 s (the Integrations screen only). Elsewhere it is just a dropdown source. */
export function useIntegrations(opts: { poll?: boolean } = {}) {
  const { current } = useWorkspace()
  return useQuery({
    queryKey: ['integrations', current.id],
    // Status and last-seen come from the shop, not from a published table, so this screen polls while visible.
    refetchInterval: opts.poll ? 5_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('integrations')
        .select(INTEGRATION_COLUMNS)
        .eq('organization_id', current.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Integration[]
    },
  })
}

export const functionsBaseUrl = () => `${import.meta.env.VITE_SUPABASE_URL ?? ''}/functions/v1`

/**
 * How many enabled "a customer signs up" automations cover this shop (all shops, or this one among those chosen). Only owners and admins can read automations,
 * so for everyone else this is simply 0 (the database decides, not this hint).
 */
export function useSignupAutomations(shopId: string | null) {
  const { current, canManage } = useWorkspace()
  return useQuery({
    queryKey: ['signup-automations', current.id, shopId],
    enabled: canManage && !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase.from('workflows').select('id, preset_config').eq('organization_id', current.id).eq('enabled', true)
      if (error) throw error
      return ((data ?? []) as { id: string; preset_config: { event?: string; integration_ids?: string[]; integration_id?: string } | null }[]).filter((w) => {
        if (w.preset_config?.event !== 'customer_signed_up') return false
        const ids = w.preset_config.integration_ids?.length ? w.preset_config.integration_ids : w.preset_config.integration_id ? [w.preset_config.integration_id] : null
        return ids === null || ids.includes(shopId!)
      }).length
    },
  })
}
