import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/auth-provider'
import { supabase } from '@/lib/supabase'

export interface Tenant {
  id: string
  name: string
  created_at: string
  owner_emails: string[]
  members: number
  integrations: number
  workflows: number
  orders: number
}

/** UI hint only: every admin RPC and the create-tenant function re-check this on the server. */
export function useIsPlatformAdmin() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['platform-admin', session?.user.id],
    enabled: Boolean(session),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_platform_admin')
      if (error) throw error
      return data === true
    },
  })
}

export function useTenants(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-tenants'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_tenants')
      if (error) throw error
      return data as Tenant[]
    },
  })
}
