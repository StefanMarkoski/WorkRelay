import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { StockConflict, StockPushStatus } from '@/types/db'

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

/** Conflicts that are settled, newest first: which number was kept, and what both sides said. */
export function useDecidedConflicts() {
  const { current } = useWorkspace()
  return useQuery({
    queryKey: ['stock-conflicts', current.id, 'decided'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_stock_conflicts', { p_org: current.id, p_status: 'decided', p_limit: 25, p_offset: 0 })
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

/** What is waiting to go to each shop and why it has not gone yet. */
export function useStockPushStatus() {
  const { current } = useWorkspace()
  return useQuery({
    queryKey: ['stock-pushes', 'status', current.id],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stock_push_status', { p_org: current.id })
      if (error) throw error
      return (data ?? []) as StockPushStatus[]
    },
  })
}
