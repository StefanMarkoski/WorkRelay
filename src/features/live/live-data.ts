import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatMoney } from '@/lib/format'
import { contextShopFilter, shopIdOfContext } from '@/lib/shop-scope'
import { supabase } from '@/lib/supabase'

export interface LiveItem {
  id: string
  kind: 'order' | 'run' | 'approval' | 'sync'
  at: string
  title: string
  to: string
  status?: string
  /** A plain-words aside under the title, e.g. whether a sync reached any automation. */
  note?: string
  shopId: string | null
}

/** The newest things first, from three sources that are all published to Realtime, so the list moves as they happen. */
export function mergeLive(orders: LiveOrder[], runs: LiveRun[], approvals: LiveApproval[], syncs: LiveSync[] = [], limit = 14): LiveItem[] {
  const items: LiveItem[] = [
    ...orders.map((o): LiveItem => ({
      id: `o-${o.id}`, kind: 'order', at: o.created_at, to: `/orders/${o.id}`, shopId: o.integration_id,
      title: `New order ${o.order_number ?? `#${o.external_id}`}${o.customer_name ? ` from ${o.customer_name}` : ''}${o.total_minor != null ? `: ${formatMoney(o.total_minor, o.currency)}` : ''}`,
    })),
    ...runs.map((r): LiveItem => ({
      id: `r-${r.id}`, kind: 'run', at: r.started_at ?? r.created_at, to: `/executions/${r.id}`, status: r.status, shopId: shopIdOfContext(r.context),
      title: r.workflows?.name ?? 'Automation',
    })),
    ...approvals.map((a): LiveItem => ({
      id: `a-${a.id}`, kind: 'approval', at: a.created_at, to: '/approvals', status: a.status, shopId: shopIdOfContext(a.context),
      title: a.title,
    })),
    ...syncs.map((x): LiveItem => ({
      id: `s-${x.id}`, kind: 'sync', at: x.created_at, to: '/inventory', shopId: x.integration_id,
      // "Marko (Admin) synced their products", or "A shop synced..." is not said: when nobody is named the subject is the shop itself
      // Said outright, so "it did not arrive" is never a mystery: either automations were started, or none was set up for it
      note: x.notified > 0 ? `${x.notified} automation${x.notified === 1 ? '' : 's'} notified` : 'No automation was set up for this',
      title: `${x.by_name && x.by_role ? `${x.by_name} (${x.by_role})` : x.by_name ?? x.by_role ?? 'A shop'} synced their products${x.products > 0 ? `: ${x.products.toLocaleString()} products` : ''}`,
    })),
  ]
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

interface LiveOrder { id: string; order_number: string | null; external_id: string; customer_name: string | null; total_minor: number | null; currency: string | null; created_at: string; integration_id: string }
interface LiveRun { id: string; status: string; created_at: string; started_at: string | null; context: unknown; workflows: { name: string } | null }
export interface LiveSync { id: string; integration_id: string; by_name: string | null; by_role: string | null; products: number; notified: number; created_at: string }
interface LiveApproval { id: string; title: string; status: string; created_at: string; context: unknown }

export function useLiveItems(shopId: string) {
  const { current } = useWorkspace()
  const org = current.id
  return useQuery({
    queryKey: ['live', org, shopId],
    placeholderData: (prev) => prev,
    refetchInterval: 30_000, // safety net: Realtime normally refreshes this as things happen
    queryFn: async () => {
      const byShop = <T,>(q: T): T => (shopId ? (q as unknown as { eq(c: string, v: string): T }).eq('integration_id', shopId) : q)
      const byContext = <T,>(q: T): T => (shopId ? (q as unknown as { or(f: string): T }).or(contextShopFilter(shopId)) : q)
      const [orders, runs, approvals, syncs] = await Promise.all([
        byShop(supabase.from('orders').select('id, order_number, external_id, customer_name, total_minor, currency, created_at, integration_id').eq('organization_id', org).order('created_at', { ascending: false }).limit(10)),
        byContext(supabase.from('workflow_runs').select('id, status, created_at, started_at, context, workflows(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(10)),
        byContext(supabase.from('approvals').select('id, title, status, created_at, context').eq('organization_id', org).order('created_at', { ascending: false }).limit(6)),
        byShop(supabase.from('product_sync_events').select('id, integration_id, by_name, by_role, products, notified, created_at').eq('organization_id', org).order('created_at', { ascending: false }).limit(6)),
      ])
      const failed = [orders, runs, approvals, syncs].find((r) => r.error)
      if (failed?.error) throw failed.error
      return mergeLive((orders.data ?? []) as LiveOrder[], (runs.data ?? []) as unknown as LiveRun[], (approvals.data ?? []) as LiveApproval[], (syncs.data ?? []) as LiveSync[])
    },
  })
}

