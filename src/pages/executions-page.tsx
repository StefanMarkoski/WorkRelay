import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { useIntegrations } from '@/features/integrations/queries'
import { shopLabel } from '@/features/integrations/shop-label'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, formatDuration, humanize } from '@/lib/format'
import { contextShopFilter, shopIdOfContext } from '@/lib/shop-scope'
import { supabase } from '@/lib/supabase'
import type { WorkflowRun } from '@/types/db'

const PAGE_SIZE = 25

export function ExecutionsPage() {
  const { current } = useWorkspace()
  const shops = useIntegrations().data ?? []
  // The shop column only matters once there is more than one shop to tell apart.
  const showShop = shops.filter((i) => i.status === 'connected').length > 1
  const shopOf = (r: WorkflowRun) => ((s) => (s ? shopLabel(s) : '—'))(shops.find((i) => i.id === shopIdOfContext(r.context)))
  const [status, setStatus] = useState('')
  const [shopId, setShopId] = useState('') // '' = all shops
  const [page, setPage] = useState(0)

  const query = useQuery({
    queryKey: ['runs', current.id, status, shopId, page],
    refetchInterval: 10_000,
    queryFn: async () => {
      let q = supabase
        .from('workflow_runs')
        .select('*, workflows(name), workflow_versions(version)', { count: 'exact' })
        .eq('organization_id', current.id)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (status) q = q.eq('status', status)
      if (shopId) q = q.or(contextShopFilter(shopId))
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as unknown as WorkflowRun[], total: count ?? 0 }
    },
  })

  return (
    <>
      <PageHeader title="Executions" description="Every automation run, with the version that started it." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b p-3">
          <Select aria-label="Filter by status" className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
            <option value="">All statuses</option>
            {['pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          {showShop && (
            <Select aria-label="Filter by shop" className="w-44" value={shopId} onChange={(e) => { setShopId(e.target.value); setPage(0) }}>
              <option value="">All shops</option>
              {shops.filter((i) => i.status === 'connected').map((i) => <option key={i.id} value={i.id}>{shopLabel(i)}</option>)}
            </Select>
          )}
        </div>
        {query.isLoading ? <TableSkeleton /> : query.error ? <ErrorState onRetry={() => query.refetch()} /> :
          query.data!.rows.length === 0 ? (
            <EmptyState icon={Play} title={status || shopId ? 'No executions match these filters' : 'No executions yet'}
              description="Runs appear here when an enabled automation is triggered." />
          ) : (
            <>
              <Table>
                <THead><tr><TH>Automation</TH><TH>Status</TH><TH>Trigger</TH>{showShop && <TH>Shop</TH>}<TH>Started</TH><TH>Duration</TH><TH>Attempts</TH></tr></THead>
                <tbody>
                  {query.data!.rows.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link to={`/executions/${r.id}`} className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">{r.workflows?.name ?? 'Automation'}</Link>
                        <span className="ml-2 text-xs text-muted-foreground">v{r.workflow_versions?.version ?? '?'}</span>
                      </TD>
                      <TD><StatusBadge status={r.status} /></TD>
                      <TD className="text-muted-foreground">{humanize(r.trigger_source)}</TD>
                      {showShop && <TD className="text-muted-foreground [overflow-wrap:anywhere]">{shopOf(r)}</TD>}
                      <TD className="whitespace-nowrap">{formatDateTime(r.started_at ?? r.created_at)}</TD>
                      <TD>{formatDuration(r.started_at, r.finished_at)}</TD>
                      <TD>{r.attempt}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <Pagination page={page} pageSize={PAGE_SIZE} total={query.data!.total} onPage={setPage} />
            </>
          )}
      </Card>
    </>
  )
}
