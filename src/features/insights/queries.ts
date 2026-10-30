import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { CustomersDaily, EventsDaily, Health, HourlyRow, OrdersDaily, RunsDaily, StatusRow, TopProduct } from './model'
import { addDays, browserTz, dayKeys, startOfDay, todayKey, type RangeDays } from './series'

/** What every Insights query hands back: the rows, and the days they were asked for (this period and the one before). */
export interface Windowed<T> {
  rows: T[]
  keys: string[]
  prevKeys: string[]
  tz: string
}

/**
 * One Insights function, scoped to a range and an optional shop. Each chart has its own query, so a slow or failed one
 * never blanks the rest, and changing the filter keeps the previous picture on screen while the new one loads.
 * `twoPeriods` also asks for the period before, for "vs previous" figures.
 */
function useWindowed<T>(fn: string, range: RangeDays, shopId: string, opts: { twoPeriods?: boolean; extra?: Record<string, unknown>; tzArg?: boolean } = {}) {
  const { current } = useWorkspace()
  const tz = browserTz()
  const { twoPeriods = false, extra = {}, tzArg = true } = opts
  return useQuery({
    queryKey: ['insights', fn, current.id, range, shopId, twoPeriods, tz, JSON.stringify(extra)],
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Windowed<T>> => {
      const keys = dayKeys(todayKey(new Date(), tz), range)
      const prevKeys = dayKeys(addDays(keys[0], -1), range)
      const since = startOfDay(twoPeriods ? prevKeys[0] : keys[0], tz).toISOString()
      const { data, error } = await supabase.rpc(fn, {
        p_org: current.id,
        p_since: since,
        ...(tzArg ? { p_tz: tz } : {}),
        p_integration: shopId || null,
        ...extra,
      })
      if (error) throw error
      return { rows: (data ?? []) as T[], keys, prevKeys, tz }
    },
  })
}

export const useOrdersDaily = (range: RangeDays, shopId: string) => useWindowed<OrdersDaily>('insights_orders_daily', range, shopId, { twoPeriods: true })
export const useRunsDaily = (range: RangeDays, shopId: string) => useWindowed<RunsDaily>('insights_runs_daily', range, shopId)
export const useEventsDaily = (range: RangeDays, shopId: string) => useWindowed<EventsDaily>('insights_events_daily', range, shopId)
export const useCustomersDaily = (range: RangeDays, shopId: string) => useWindowed<CustomersDaily>('insights_customers_daily', range, shopId)
export const useOrderStatus = (range: RangeDays, shopId: string) => useWindowed<StatusRow>('insights_order_status', range, shopId, { tzArg: false })
export const useTopProducts = (range: RangeDays, shopId: string) => useWindowed<TopProduct>('insights_top_products', range, shopId, { tzArg: false, extra: { p_limit: 8 } })
export const useHourly = (range: RangeDays, shopId: string) => useWindowed<HourlyRow>('insights_hourly', range, shopId)

/** How the catalogue stands right now (not a period), optionally for one shop. */
export function useInventoryHealth(shopId: string) {
  const { current } = useWorkspace()
  return useQuery({
    queryKey: ['insights', 'health', current.id, shopId],
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Health> => {
      const { data, error } = await supabase.rpc('insights_inventory_health', { p_org: current.id, p_integration: shopId || null })
      if (error) throw error
      const row = ((data ?? []) as Health[])[0]
      return row ?? { low: 0, ok: 0, no_threshold: 0, not_reported: 0 }
    },
  })
}
