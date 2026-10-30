import { AlertTriangle, Inbox, Play, Plug, ShoppingCart, Zap } from 'lucide-react'
import type { CSSProperties } from "react"
import { useState } from 'react'
import { Link } from "react-router-dom"
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { NumberTicker } from '@/components/ui/number-ticker'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { Select } from '@/components/ui/input'
import { OrdersTrendCard } from '@/features/insights/orders-trend'
import type { RangeDays } from '@/features/insights/series'
import { useIntegrations } from '@/features/integrations/queries'
import { LiveFeed } from '@/features/live/live-feed'
import { useOverview } from '@/features/overview/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDuration, formatMoney, humanize, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Each cell carries one lamp. It is lit only when the number means something: work is running, or something needs a look. */
const LAMP: Record<'success' | 'danger' | 'warning', string> = {
  success: 'bg-success',
  danger: 'bg-destructive',
  warning: 'bg-warning',
}

function Stat({ label, value, caption, note, tone, lit, to, index }: {
  index: number
  label: string
  value: number
  caption?: string
  note: string
  tone: keyof typeof LAMP
  lit: boolean
  to: string
}) {
  return (
    <Link to={to} style={{ '--i': index } as CSSProperties} className="reveal bg-card p-5 outline-none transition-colors duration-150 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span aria-hidden className={cn('size-2 rounded-full', lit ? LAMP[tone] : 'bg-[var(--lamp-off)]')} />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <p className="tnum font-display text-4xl leading-none font-semibold tracking-[-0.03em]">{value === 0 ? '0' : <NumberTicker value={value} />}</p>
        {caption && <span className="text-xs text-muted-foreground">{caption}</span>}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">{note}</p>
    </Link>
  )
}

const STATUS_BAR: Record<string, string> = {
  pending: 'bg-warning',
  processing: 'bg-info',
  completed: 'bg-success',
  cancelled: 'bg-destructive',
  unknown: 'bg-muted-foreground',
}

export function OverviewPage() {
  const { current } = useWorkspace()
  const [shopId, setShopId] = useState('') // '' = the whole workspace
  const [range, setRange] = useState<RangeDays>(30)
  const shops = (useIntegrations().data ?? []).filter((i) => i.status !== 'revoked')
  const q = useOverview(shopId)
  const shop = shops.find((i) => i.id === shopId) ?? null

  if (q.isLoading) {
    return (
      <>
        <PageHeader title="Overview" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      </>
    )
  }
  if (q.error) return <ErrorState onRetry={() => q.refetch()} />
  const d = q.data!
  const totalOrders = d.orderStatuses.reduce((n, s) => n + s.count, 0)
  const brandNew = !shopId && d.workflows === 0 && d.integrationCount === 0 && totalOrders === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description={shop ? `Orders, automations and activity for ${shop.name} only.` : `Workspace health, orders, and automations for ${current.name}.`}
        actions={
          <>
            <Link to="/insights" className="text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">More in Insights</Link>
            {shops.length > 1 && (
              <Select aria-label="Shop" className="w-48" value={shopId} onChange={(e) => setShopId(e.target.value)}>
                <option value="">All shops</option>
                {shops.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </Select>
            )}
          </>
        }
      />

      {brandNew && (
        <Card>
          <EmptyState
            icon={Plug}
            title="Connect your first store"
            description="Create a connection, paste its secret key into your shop, and orders will start appearing here. Then turn on an automation to act on them."
            action={<Link to="/integrations"><Button>Go to integrations</Button></Link>}
          />
        </Card>
      )}

      {d.warnings.length > 0 && (
        <div className="space-y-2" role="region" aria-label="Needs attention">
          {d.warnings.map((w) => (
            <Link key={w.id} to={w.to} className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] hover:bg-warning/15">
              <AlertTriangle className="size-4 shrink-0 text-warning" /> {w.text}
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
        <Stat index={0} label="Automations" value={d.workflows} tone="success" lit={d.activeWorkflows > 0} to="/automations"
          note={d.workflows === 0 ? 'None set up yet' : `${d.activeWorkflows} of ${d.workflows} turned on`} />
        <Stat index={1} label="Successful runs (7d)" value={d.runsOk} tone="success" lit={d.runsOk > 0} to="/executions" note="Last 7 days" />
        <Stat index={2} label="Failed runs (7d)" value={d.runsFailed} caption={d.runsFailed === 0 ? 'none' : undefined} tone="danger" lit={d.runsFailed > 0} to="/executions"
          note={d.runsFailed === 0 ? 'Nothing needs a look' : 'Open Executions to see why'} />
        <Stat index={3} label="Pending approvals" value={d.pendingApprovals} caption={d.pendingApprovals === 0 ? 'queue clear' : undefined} tone="warning" lit={d.pendingApprovals > 0} to="/approvals"
          note={d.pendingApprovals === 0 ? 'Nothing is waiting' : 'Waiting for a decision'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="grid lg:col-span-8"><OrdersTrendCard range={range} shopId={shopId} onRange={setRange} /></div>
        <LiveFeed shopId={shopId} className="lg:col-span-4" />
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="reveal lg:col-span-7" style={{ '--i': 4 } as CSSProperties}>
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            <Link to="/orders" className="text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">View all →</Link>
          </CardHeader>
          {d.recentOrders.length === 0 ? (
            <EmptyState icon={ShoppingCart} title="No orders yet" description="Orders show up here as your store sends them." />
          ) : (
            <>
              <Table>
                <THead><tr><TH>Order</TH><TH className="hidden sm:table-cell">Customer</TH><TH className="text-right">Amount</TH><TH className="text-center">Status</TH></tr></THead>
                <tbody>
                  {d.recentOrders.map((o) => (
                    <TR key={o.id}>
                      <TD className="min-w-28"><Link to={`/orders/${o.id}`} className="inline-block max-w-60 align-top font-medium [overflow-wrap:anywhere] text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">{o.order_number ?? `#${o.external_id}`}</Link></TD>
                      <TD className="hidden text-muted-foreground sm:table-cell">{o.customer_name ?? '—'}</TD>
                      <TD className="text-right font-medium tabular-nums">{formatMoney(o.total_minor, o.currency)}</TD>
                      <TD className="text-center"><StatusBadge status={o.status} /></TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">Showing {d.recentOrders.length} of {totalOrders} {totalOrders === 1 ? 'order' : 'orders'}</p>
            </>
          )}
        </Card>

        <Card className="reveal lg:col-span-5" style={{ '--i': 5 } as CSSProperties}>
          <CardHeader>
            <CardTitle>Order status</CardTitle>
            <span className="text-xs text-muted-foreground">Total: {totalOrders}</span>
          </CardHeader>
          <div className="space-y-4 p-5">
            {totalOrders === 0 ? (
              <p className="text-sm text-muted-foreground">No orders to chart yet.</p>
            ) : (
              d.orderStatuses.map((s) => (
                <div key={s.status} className={cn(s.count === 0 && 'opacity-50')}>
                  <div className="mb-1.5 flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-2"><span className={cn('size-2 rounded-full', STATUS_BAR[s.status])} />{humanize(s.status)}</span>
                    <span className="tabular-nums text-muted-foreground">{s.count} ({Math.round((s.count / totalOrders) * 100)}%)</span>
                  </div>
                  <div className="h-2 rounded-sm border bg-muted" role="img" aria-label={`${s.count} of ${totalOrders} orders`}>
                    <div className={cn('h-full rounded-[1px]', STATUS_BAR[s.status])} style={{ width: `${(s.count / totalOrders) * 100}%` }} />
                  </div>
                </div>
              ))
            )}
            <Link to="/orders" className="mt-2 block w-full rounded-md border bg-muted/50 px-3 py-2 text-center text-xs font-medium hover:bg-muted">View all orders</Link>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent executions</CardTitle>
            <Link to="/executions" className="text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">View all</Link>
          </CardHeader>
          {d.recentRuns.length === 0 ? (
            <EmptyState icon={Zap} title="No executions yet" description={d.workflows === 0 ? 'Turn on an automation to see runs here.' : 'Runs appear when an automation is triggered.'}
              action={d.workflows === 0 ? <Link to="/automations"><Button variant="outline">Set up an automation</Button></Link> : undefined} />
          ) : (
            <ul className="space-y-2 p-4">
              {d.recentRuns.map((r) => (
                <li key={r.id}>
                  <Link to={`/executions/${r.id}`} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 hover:bg-muted/70">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-7 shrink-0 place-items-center rounded-md border bg-secondary text-muted-foreground"><Play className="size-3.5" /></span>
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-xs font-medium [overflow-wrap:anywhere]" title={r.workflows?.name ?? undefined}>{r.workflows?.name ?? 'Automation'}</span>
                        <span className="block text-[11px] text-muted-foreground">Started {timeAgo(r.started_at ?? r.created_at)}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <StatusBadge status={r.status} />
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{formatDuration(r.started_at, r.finished_at)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integration events</CardTitle>
            <Link to="/integrations" className="text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">View all</Link>
          </CardHeader>
          {d.recentEvents.length === 0 ? (
            <EmptyState icon={Inbox} title="No events received" description="Webhook deliveries from connected stores are listed here." />
          ) : (
            <ul className="space-y-2 p-4 text-xs">
              {d.recentEvents.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
                  <span className="min-w-0 truncate" title={`${e.event_type ?? 'unknown'} ${e.event_id}`}><span className="mr-2 font-medium">{e.event_type ?? 'unknown'}</span><span className="font-mono text-muted-foreground">{e.event_id}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><span className="text-[11px] text-muted-foreground">{timeAgo(e.received_at)}</span><StatusBadge status={e.status} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {d.pending.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Waiting for a decision</CardTitle><Link to="/approvals" className="text-xs font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Review</Link></CardHeader>
          <ul className="divide-y">{d.pending.map((a) => <li key={a.id} className="flex justify-between px-5 py-3 text-[13px]"><span>{a.title}</span><span className="text-xs text-muted-foreground">{timeAgo(a.created_at)}</span></li>)}</ul>
        </Card>
      )}
    </div>
  )
}
