import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, TableSkeleton } from '@/components/common/states'
import { JsonView } from '@/components/common/json-view'
import { StatusBadge } from '@/components/common/status-badge'
import { formatDateTime, formatDuration, humanize } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { StepRun, WorkflowRun } from '@/types/db'

export function ExecutionDetailPage() {
  const { id } = useParams()
  const query = useQuery({
    queryKey: ['run', id],
    refetchInterval: (q) => (['pending', 'running', 'waiting_approval'].includes(q.state.data?.run?.status ?? '') ? 5000 : false),
    queryFn: async () => {
      const [run, steps] = await Promise.all([
        supabase.from('workflow_runs').select('*, workflows(name), workflow_versions(version)').eq('id', id!).maybeSingle(),
        supabase.from('step_runs').select('*').eq('run_id', id!).order('position'),
      ])
      if (run.error) throw run.error
      if (steps.error) throw steps.error
      return { run: run.data as unknown as WorkflowRun | null, steps: steps.data as StepRun[] }
    },
  })

  if (query.isLoading) return <TableSkeleton rows={6} />
  if (query.error) return <ErrorState onRetry={() => query.refetch()} />
  const { run, steps } = query.data!
  if (!run) return <ErrorState message="Execution not found." />

  return (
    <>
      <Link to="/executions" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Executions
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{run.workflows?.name ?? 'Workflow'}</h1>
        <StatusBadge status={run.status} />
        <span className="text-sm text-muted-foreground">v{run.workflow_versions?.version ?? '?'}</span>
      </div>

      <Card className="mb-4">
        <CardBody className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Trigger</p>{humanize(run.trigger_source)}</div>
          <div><p className="text-xs text-muted-foreground">Event</p><span className="font-mono text-xs">{run.event_id ?? '—'}</span></div>
          <div><p className="text-xs text-muted-foreground">Started</p>{formatDateTime(run.started_at)}</div>
          <div><p className="text-xs text-muted-foreground">Duration</p>{formatDuration(run.started_at, run.finished_at)}</div>
        </CardBody>
        {run.error && <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">{run.error}</p>}
      </Card>

      <Card>
        <CardHeader><CardTitle>Steps</CardTitle></CardHeader>
        {steps.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No steps have executed yet.</p>
        ) : (
          <ol className="divide-y">
            {steps.map((s, i) => (
              <li key={s.id} className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid size-5 place-items-center rounded bg-accent text-xs text-accent-foreground">{i + 1}</span>
                  <span className="text-sm font-medium">{s.step_name ?? s.step_key}</span>
                  <StatusBadge status={s.status} />
                  <span className="text-xs text-muted-foreground">{formatDuration(s.started_at, s.finished_at)}</span>
                  {s.attempt > 1 && <span className="text-xs text-warning">{s.attempt} attempts</span>}
                </div>
                {s.error && <p role="alert" className="mt-2 text-sm text-destructive">{s.error}</p>}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Input and output (sensitive values redacted)</summary>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div><p className="mb-1 text-xs text-muted-foreground">Input</p><JsonView value={s.input} /></div>
                    <div><p className="mb-1 text-xs text-muted-foreground">Output</p><JsonView value={s.output} /></div>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  )
}
