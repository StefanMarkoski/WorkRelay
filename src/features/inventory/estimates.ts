import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface StockEstimate {
  product_id: string
  estimated: number
  sold_since: number
  as_of: string
}

/** Estimated stock for some products (only those of shops that switched estimating on), keyed by product id. */
export function useStockEstimates(orgId: string, productIds: string[]) {
  const ids = [...productIds].sort()
  return useQuery({
    queryKey: ['stock-estimates', orgId, ids],
    enabled: ids.length > 0,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stock_estimates', { p_org: orgId, p_ids: ids })
      if (error) throw error
      return new Map(((data ?? []) as StockEstimate[]).map((e) => [e.product_id, { ...e, estimated: Number(e.estimated), sold_since: Number(e.sold_since) }]))
    },
  })
}
