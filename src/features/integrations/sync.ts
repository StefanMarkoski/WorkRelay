import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { IntegrationSync } from '@/types/db'

export const SYNC_COLUMNS =
  'integration_id, source_url, has_auth_header, push_enabled, paused, calls, days, next_sync_at, last_sync_at, last_error, window_start, window_used, last_push_at, last_push_by'

/** Every shop's feed settings in this workspace (the auth header is never part of it). */
export function useIntegrationSyncs() {
  const { current } = useWorkspace()
  return useQuery({
    queryKey: ['integration-sync', current.id],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('integration_sync').select(SYNC_COLUMNS).eq('organization_id', current.id)
      if (error) throw error
      return (data ?? []) as IntegrationSync[]
    },
  })
}

export interface SyncNowResult {
  status: 'ok' | 'failed'
  products?: number
  error?: string
  calls_left?: number
}

/** The sentence behind a refused or failed call: the function's own readable detail when it sent one. */
async function refusalText(error: unknown): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.json()
    if (body?.detail) return String(body.detail)
    if (body?.error === 'forbidden') return 'Only owners and admins can sync a shop.'
    if (body?.error === 'unauthenticated') return 'Your session has expired. Sign out and sign in again.'
  } catch {
    // no readable body
  }
  if (!(error as { context?: unknown } | null)?.context) return 'Could not reach the server. Check your connection.'
  return 'Something went wrong. Please try again.'
}

/** Runs one shop's pull now. Throws an Error with a readable message when WorkRelay refuses; a shop that answers badly comes back as status "failed". */
export function useSyncNow() {
  const qc = useQueryClient()
  return async (integrationId: string): Promise<SyncNowResult> => {
    const { data, error } = await supabase.functions.invoke('sync-now', { body: { integration_id: integrationId } })
    if (error) throw new Error(await refusalText(error))
    for (const key of ['integration-sync', 'products', 'product', 'insights', 'live', 'overview', 'webhook-events']) {
      void qc.invalidateQueries({ queryKey: [key] })
    }
    return data as SyncNowResult
  }
}
