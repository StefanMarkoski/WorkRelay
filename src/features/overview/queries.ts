import { useQuery } from '@tanstack/react-query'
import { shopIds } from '@/domain/presets'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { contextShopFilter } from '@/lib/shop-scope'
import { supabase } from '@/lib/supabase'
import type { Approval, Integration, Order, WebhookEvent, WorkflowRun } from '@/types/db'

const ORDER_STATUSES = ['pending', 'processing', 'completed', 'cancelled', 'unknown'] as const
const DAY = 86_400_000
/** Same rule as the Automations page: presets and published workflows; unpublished drafts do not count. */
const VISIBLE_AUTOMATIONS = 'preset.not.is.null,current_version_id.not.is.null'

/** `shopId`: '' for the whole workspace, or one shop to see only its orders, events, runs and approvals. */
export function useOverview(shopId = '') {
  const { current } = useWorkspace()
  const org = current.id
  return useQuery({
    queryKey: ['overview', org, shopId],
    placeholderData: (prev) => prev, // keep the page on screen while another shop loads
    refetchInterval: 30_000,
    queryFn: async () => {
      const since7 = new Date(Date.now() - 7 * DAY).toISOString()
      const since1 = new Date(Date.now() - DAY).toISOString()
      // Orders and events carry the shop in a column; runs and approvals carry it inside their context.
      const byShop = <T,>(q: T): T => (shopId ? (q as unknown as { eq(c: string, v: string): T }).eq('integration_id', shopId) : q)
      const byContext = <T,>(q: T): T => (shopId ? (q as unknown as { or(f: string): T }).or(contextShopFilter(shopId)) : q)
      const count = (table: string) => supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', org)

      const [
        workflowRows, runsOk, runsFailed, pendingApprovals, pendingList,
        recentRuns, recentOrders, recentEvents, integrations, failedEvents, ...statusCounts
      ] = await Promise.all([
        supabase.from('workflows').select('id, enabled, preset_config').eq('organization_id', org).is('deleted_at', null).or(VISIBLE_AUTOMATIONS),
        byContext(count('workflow_runs').eq('status', 'succeeded').gte('created_at', since7)),
        byContext(count('workflow_runs').eq('status', 'failed').gte('created_at', since7)),
        byContext(count('approvals').eq('status', 'pending')),
        byContext(supabase.from('approvals').select('id, title, created_at').eq('organization_id', org).eq('status', 'pending').order('created_at').limit(3)),
        byContext(supabase.from('workflow_runs').select('id, status, created_at, started_at, finished_at, workflows(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(5)),
        byShop(supabase.from('orders').select('id, order_number, external_id, customer_name, total_minor, currency, status, placed_at, created_at').eq('organization_id', org).order('created_at', { ascending: false }).limit(5)),
        byShop(supabase.from('webhook_events').select('id, event_id, event_type, status, received_at').eq('organization_id', org).order('received_at', { ascending: false }).limit(6)),
        supabase.from('integrations').select('id, name, status, currency').eq('organization_id', org),
        byShop(count('webhook_events').eq('status', 'failed').gte('received_at', since1)),
        ...ORDER_STATUSES.map((s) => byShop(count('orders').eq('status', s))),
      ])

      const all = [workflowRows, runsOk, runsFailed, pendingApprovals, pendingList, recentRuns, recentOrders, recentEvents, integrations, failedEvents, ...statusCounts]
      const failed = all.find((r) => r.error)
      if (failed?.error) throw failed.error

      const integ = (integrations.data ?? []) as Pick<Integration, 'id' | 'name' | 'status' | 'currency'>[]
      // An automation counts for a shop when it covers all shops or names this one (custom workflows cover every shop).
      const covered = ((workflowRows.data ?? []) as { id: string; enabled: boolean; preset_config: Record<string, unknown> | null }[]).filter((w) => {
        if (!shopId) return true
        const ids = shopIds((w.preset_config ?? {}) as { integration_ids?: string[]; integration_id?: string })
        return !ids || ids.includes(shopId)
      })
      const warnings: { id: string; text: string; to: string }[] = []
      for (const i of integ.filter((x) => x.status === 'awaiting_bind' && (!shopId || x.id === shopId))) {
        warnings.push({ id: `bind-${i.id}`, text: `"${i.name}" has not been bound by its store yet.`, to: '/integrations' })
      }
      for (const i of integ.filter((x) => x.status !== 'revoked' && !x.currency && (!shopId || x.id === shopId))) {
        warnings.push({ id: `currency-${i.id}`, text: `"${i.name}" has no currency yet. Set one in its details so its orders are counted in the right currency.`, to: '/integrations' })
      }
      if ((failedEvents.count ?? 0) > 0) warnings.push({ id: 'failed-events', text: `${failedEvents.count} webhook ${failedEvents.count === 1 ? 'event' : 'events'} failed in the last 24 hours.`, to: '/integrations' })
      if ((runsFailed.count ?? 0) > 0) warnings.push({ id: 'failed-runs', text: `${runsFailed.count} automation ${runsFailed.count === 1 ? 'run' : 'runs'} failed in the last 7 days.`, to: '/executions' })

      return {
        workflows: covered.length,
        activeWorkflows: covered.filter((w) => w.enabled).length,
        runsOk: runsOk.count ?? 0,
        runsFailed: runsFailed.count ?? 0,
        pendingApprovals: pendingApprovals.count ?? 0,
        pending: (pendingList.data ?? []) as Pick<Approval, 'id' | 'title' | 'created_at'>[],
        recentRuns: (recentRuns.data ?? []) as unknown as WorkflowRun[],
        recentOrders: (recentOrders.data ?? []) as unknown as Order[],
        recentEvents: (recentEvents.data ?? []) as WebhookEvent[],
        orderStatuses: ORDER_STATUSES.map((s, i) => ({ status: s, count: statusCounts[i].count ?? 0 })),
        integrationCount: integ.length,
        warnings,
      }
    },
  })
}
