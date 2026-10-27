import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'

export const INTEGRATION_COLUMNS =
  'id, organization_id, kind, name, status, key_prefix, external_store_id, external_base_url, bound_at, last_seen_at, created_at'

export function useIntegrations() {
  const { current } = useWorkspace()
  return useQuery({
    queryKey: ['integrations', current.id],
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
