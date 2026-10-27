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
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, formatDuration, humanize } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { WorkflowRun } from '@/types/db'

const PAGE_SIZE = 25

export function ExecutionsPage() {
  const { current } = useWorkspace()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)

  const query = useQuery({
    queryKey: ['runs', current.id, status, page],
    refetchInterval: 10_000,
    queryFn: async () => {
      let q = supabase
        .from('workflow_runs')
        .select('*, workflows(name), workflow_versions(version)', { count: 'exact' })
        .eq('organization_id', current.id)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (status) q = q.eq('status', status)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as unknown as WorkflowRun[], total: count ?? 0 }
    },
  })

  return (
    <>
      <PageHeader title="Executions" description="Every workflow run, with the version that started it." />
      <Card>
        <div className="border-b p-3">
          <Select aria-label="Filter by status" className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
            <option value="">All statuses</option>
            {['pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
        </div>
        {query.isLoading ? <TableSkeleton /> : query.error ? <ErrorState onRetry={() => query.refetch()} /> :
          query.data!.rows.length === 0 ? (
            <EmptyState icon={Play} title={status ? 'No executions with this status' : 'No executions yet'}
              description="Runs appear here when an enabled, published workflow is triggered." />
          ) : (
            <>
              <Table>
                <THead><tr><TH>Workflow</TH><TH>Status</TH><TH>Trigger</TH><TH>Started</TH><TH>Duration</TH><TH>Attempts</TH></tr></THead>
                <tbody>
                  {query.data!.rows.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link to={`/executions/${r.id}`} className="font-medium text-primary hover:underline">{r.workflows?.name ?? 'Workflow'}</Link>
                        <span className="ml-2 text-xs text-muted-foreground">v{r.workflow_versions?.version ?? '?'}</span>
                      </TD>
                      <TD><StatusBadge status={r.status} /></TD>
                      <TD className="text-muted-foreground">{humanize(r.trigger_source)}</TD>
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
