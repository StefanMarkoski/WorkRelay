import { useQuery } from '@tanstack/react-query'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { supabase } from '@/lib/supabase'
import type { Approval, Integration, Order, WebhookEvent, WorkflowRun } from '@/types/db'

const ORDER_STATUSES = ['pending', 'processing', 'completed', 'cancelled', 'unknown'] as const
const DAY = 86_400_000
/** Same rule as the Automations page: presets and published workflows; unpublished drafts do not count. */
const VISIBLE_AUTOMATIONS = 'preset.not.is.null,current_version_id.not.is.null'

export function useOverview() {
  const { current } = useWorkspace()
  const org = current.id
  return useQuery({
    queryKey: ['overview', org],
    refetchInterval: 30_000,
    queryFn: async () => {
      const since7 = new Date(Date.now() - 7 * DAY).toISOString()
      const since1 = new Date(Date.now() - DAY).toISOString()
      const count = (table: string) => supabase.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', org)

      const [
        workflows, activeWorkflows, runsOk, runsFailed, pendingApprovals, pendingList,
        recentRuns, recentOrders, recentEvents, integrations, failedEvents, ...statusCounts
      ] = await Promise.all([
        count('workflows').or(VISIBLE_AUTOMATIONS),
        count('workflows').eq('enabled', true),
        count('workflow_runs').eq('status', 'succeeded').gte('created_at', since7),
        count('workflow_runs').eq('status', 'failed').gte('created_at', since7),
        count('approvals').eq('status', 'pending'),
        supabase.from('approvals').select('id, title, created_at').eq('organization_id', org).eq('status', 'pending').order('created_at').limit(3),
        supabase.from('workflow_runs').select('id, status, created_at, started_at, finished_at, workflows(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(5),
        supabase.from('orders').select('id, order_number, external_id, customer_name, total_minor, currency, status, placed_at, created_at').eq('organization_id', org).order('created_at', { ascending: false }).limit(5),
        supabase.from('webhook_events').select('id, event_id, event_type, status, received_at').eq('organization_id', org).order('received_at', { ascending: false }).limit(6),
        supabase.from('integrations').select('id, name, status').eq('organization_id', org),
        count('webhook_events').eq('status', 'failed').gte('received_at', since1),
        ...ORDER_STATUSES.map((s) => count('orders').eq('status', s)),
      ])

      const all = [workflows, activeWorkflows, runsOk, runsFailed, pendingApprovals, pendingList, recentRuns, recentOrders, recentEvents, integrations, failedEvents, ...statusCounts]
      const failed = all.find((r) => r.error)
      if (failed?.error) throw failed.error

      const integ = (integrations.data ?? []) as Pick<Integration, 'id' | 'name' | 'status'>[]
      const warnings: { id: string; text: string; to: string }[] = []
      for (const i of integ.filter((x) => x.status === 'awaiting_bind')) {
        warnings.push({ id: `bind-${i.id}`, text: `"${i.name}" has not been bound by its store yet.`, to: '/integrations' })
      }
      if ((failedEvents.count ?? 0) > 0) warnings.push({ id: 'failed-events', text: `${failedEvents.count} webhook ${failedEvents.count === 1 ? 'event' : 'events'} failed in the last 24 hours.`, to: '/integrations' })
      if ((runsFailed.count ?? 0) > 0) warnings.push({ id: 'failed-runs', text: `${runsFailed.count} automation ${runsFailed.count === 1 ? 'run' : 'runs'} failed in the last 7 days.`, to: '/executions' })

      return {
        workflows: workflows.count ?? 0,
        activeWorkflows: activeWorkflows.count ?? 0,
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
