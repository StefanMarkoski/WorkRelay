import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** A row of list_failures: an incoming event that failed, or an automation run that failed. */
export interface Failure {
  id: string
  kind: 'event' | 'run'
  at: string
  integration_id: string | null
  integration_name: string | null
  /** The event type, or the automation's name. */
  subject: string
  /** The shop's event id, or the run's trigger event id. */
  ref: string | null
  error: string | null
  total_count: number
}

/** How many things failed in the last 24 hours, for the count beside "Failures" in the menu. */
export function useRecentFailureCount(orgId: string) {
  return useQuery({
    queryKey: ['failures', orgId, 'count-24h'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_failures', { p_org: orgId, p_days: 1, p_limit: 1 })
      if (error) throw error
      return Number(((data ?? []) as Failure[])[0]?.total_count ?? 0)
    },
  })
}
