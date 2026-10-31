import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { StockConflict } from '@/types/db'

/** Conflicts waiting for the owner. The count also rides on the Inventory page's button. */
export function useOpenConflicts() {
  const { current } = useWorkspace()
  return useQuery({
    queryKey: ['stock-conflicts', current.id, 'open'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_stock_conflicts', { p_org: current.id, p_status: 'open', p_limit: 100, p_offset: 0 })
      if (error) throw error
      return (data ?? []) as StockConflict[]
    },
  })
}

/** "The shop says 8, WorkRelay says 10": the sentence and the signed difference of a conflict. */
export function conflictDiff(c: Pick<StockConflict, 'workrelay_value' | 'shop_value'>): { diff: number; text: string } {
  const diff = c.workrelay_value - c.shop_value
  return { diff, text: diff === 0 ? 'same' : `${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString()}` }
}

/** What each state of a conflict is called in the app. */
export const CONFLICT_STATUS_LABEL = {
  open: 'Waiting for your decision',
  kept_shop: 'Kept the shop\'s number',
  sent_workrelay: 'Sent WorkRelay\'s number',
  agreed: 'Agreed on the next report',
} as const
