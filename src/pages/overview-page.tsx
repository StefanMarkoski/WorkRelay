import { AlertTriangle, GitBranch, Inbox, Play, Plug, ShoppingCart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { useOverview } from '@/features/overview/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatMoney, humanize, timeAgo } from '@/lib/format'

function Stat({ label, value, hint, to }: { label: string; value: number; hint?: string; to: string }) {
  return (
    <Link to={to} className="rounded-lg border bg-card p-4 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {/* Ticker only animates from 0 once; for 0 it renders a plain value. */}
        {value === 0 ? '0' : <NumberTicker value={value} />}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Link>
  )
}

export function OverviewPage() {
  const { current } = useWorkspace()
  const q = useOverview()

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="Overview" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      </>
    )
  }
  if (q.error) return <ErrorState onRetry={() => q.refetch()} />
  const d = q.data!
  const totalOrders = d.orderStatuses.reduce((n, s) => n + s.count, 0)
  const brandNew = d.workflows === 0 && d.integrationCount === 0 && totalOrders === 0

  return (
    <>
      <PageHeader title="Overview" description={`Workspace health for ${current.name}.`} />

      {brandNew && (
        <Card className="mb-4">
          <EmptyState
            icon={Plug}
            title="Connect your first store"
            description="Create a connection, paste its secret key into your commerce app, and orders will start appearing here. Then build workflows to automate them."
            action={<Link to="/integrations"><Button>Go to integrations</Button></Link>}
          />
        </Card>
      )}

      {d.warnings.length > 0 && (
        <div className="mb-4 space-y-2" role="region" aria-label="Needs attention">
          {d.warnings.map((w) => (
            <Link key={w.id} to={w.to} className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm hover:bg-warning/15">
              <AlertTriangle className="size-4 shrink-0 text-warning" /> {w.text}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Workflows" value={d.workflows} hint={`${d.activeWorkflows} active`} to="/workflows" />
        <Stat label="Successful runs (7d)" value={d.runsOk} to="/executions" />
        <Stat label="Failed runs (7d)" value={d.runsFailed} to="/executions" />
        <Stat label="Pending approvals" value={d.pendingApprovals} to="/approvals" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent orders</CardTitle><Link to="/orders" className="text-xs text-primary hover:underline">View all</Link></CardHeader>
          {d.recentOrders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No orders yet" description="Orders show up here as your store sends them." />
          ) : (
            <ul className="divide-y">
              {d.recentOrders.map((o) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted/40">
                    <span className="min-w-0"><span className="font-medium">{o.order_number ?? `#${o.external_id}`}</span> <span className="text-muted-foreground">{o.customer_name ?? ''}</span></span>
                    <span className="flex items-center gap-3"><span className="tabular-nums">{formatMoney(o.total_minor, o.currency)}</span><StatusBadge status={o.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Order status</CardTitle></CardHeader>
          <CardBody>
            {totalOrders === 0 ? (
              <p className="text-sm text-muted-foreground">No orders to chart yet.</p>
            ) : (
              <ul className="space-y-3">
                {d.orderStatuses.filter((s) => s.count > 0).map((s) => (
                  <li key={s.status}>
                    <div className="mb-1 flex justify-between text-sm"><span>{humanize(s.status)}</span><span className="tabular-nums text-muted-foreground">{s.count}</span></div>
                    <div className="h-1.5 rounded-full bg-muted" role="img" aria-label={`${s.count} of ${totalOrders} orders`}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(s.count / totalOrders) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent executions</CardTitle><Link to="/executions" className="text-xs text-primary hover:underline">View all</Link></CardHeader>
          {d.recentRuns.length === 0 ? (
            <EmptyState icon={d.workflows === 0 ? GitBranch : Play} title="No executions yet"
              description={d.workflows === 0 ? 'Create and publish a workflow to see runs here.' : 'Runs appear when an enabled workflow is triggered.'}
              action={d.workflows === 0 ? <Link to="/workflows"><Button variant="outline">Create a workflow</Button></Link> : undefined} />
          ) : (
            <ul className="divide-y">
              {d.recentRuns.map((r) => (
                <li key={r.id}>
                  <Link to={`/executions/${r.id}`} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-muted/40">
                    <span>{r.workflows?.name ?? 'Workflow'}</span>
                    <span className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{timeAgo(r.created_at)}</span><StatusBadge status={r.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Integration events</CardTitle><Link to="/integrations" className="text-xs text-primary hover:underline">View all</Link></CardHeader>
          {d.recentEvents.length === 0 ? (
            <EmptyState icon={Inbox} title="No events received" description="Webhook deliveries from connected stores are listed here." />
          ) : (
            <ul className="divide-y">
              {d.recentEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium">{e.event_type ?? 'unknown'}</span> <span className="font-mono text-xs text-muted-foreground">{e.event_id}</span></span>
                  <span className="flex shrink-0 items-center gap-3"><span className="text-xs text-muted-foreground">{timeAgo(e.received_at)}</span><StatusBadge status={e.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {d.pending.length > 0 && (
        <Card className="mt-4">
          <CardHeader><CardTitle>Waiting for a decision</CardTitle><Link to="/approvals" className="text-xs text-primary hover:underline">Review</Link></CardHeader>
          <ul className="divide-y">{d.pending.map((a) => <li key={a.id} className="flex justify-between px-4 py-2.5 text-sm"><span>{a.title}</span><span className="text-xs text-muted-foreground">{timeAgo(a.created_at)}</span></li>)}</ul>
        </Card>
      )}
    </>
  )
}
