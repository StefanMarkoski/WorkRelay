import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'

export const INTEGRATION_COLUMNS =
  'id, organization_id, kind, name, status, key_prefix, external_store_id, external_base_url, bound_at, last_seen_at, created_at, track_signups, signups_enabled_at'

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
