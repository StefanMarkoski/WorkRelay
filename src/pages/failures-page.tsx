import { useQuery } from '@tanstack/react-query'
import { ChevronRight, CircleCheck } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { explainFailure } from '@/features/failures/explain'
import { useFailureRetention } from '@/features/failures/retention'
import type { Failure } from '@/features/failures/queries'
import { useIntegrations } from '@/features/integrations/queries'
import { shopLabel } from '@/features/integrations/shop-label'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 20

type Kind = '' | 'event' | 'run'
const KINDS: { id: Kind; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'event', label: 'Incoming events' },
  { id: 'run', label: 'Automation runs' },
]
const PERIODS = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
  { days: 365, label: 'Last year' },
]

function Details({ f }: { f: Failure }) {
  const x = explainFailure(f.kind, f.error)
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <p className="text-xs font-medium text-muted-foreground">What happened</p>
        <p className="mt-1 max-w-[62ch] text-sm leading-relaxed">{x.reason}</p>
        <p className="mt-4 text-xs font-medium text-muted-foreground">What to do</p>
        <p className="mt-1 max-w-[62ch] text-sm leading-relaxed">{x.fix}</p>
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">Details</p>
        <dl className="mt-1 space-y-1.5 text-[13px]">
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Time</dt><dd>{formatDateTime(f.at)}</dd></div>
          {f.kind === 'event' && f.ref && (
            <div className="flex gap-2"><dt className="w-20 shrink-0 text-muted-foreground">Event id</dt><dd className="font-mono text-xs [overflow-wrap:anywhere]">{f.ref}</dd></div>
          )}
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted-foreground">Raw reason</dt>
            <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{f.error ?? 'not recorded'}</dd>
          </div>
        </dl>
        {f.kind === 'run' && (
          <Link to="/executions" className="mt-3 inline-block text-sm underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
            Open Executions to see the steps
          </Link>
        )}
        {f.kind === 'event' && (
          <Link to="/integrations" className="mt-3 inline-block text-sm underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
            Open Event history for this shop
          </Link>
        )}
      </div>
    </div>
  )
}

export function FailuresPage() {
  const { current } = useWorkspace()
  const shops = (useIntegrations().data ?? []).filter((i) => i.status !== 'revoked')
  const [kind, setKind] = useState<Kind>('')
  const [shopId, setShopId] = useState('')
  const [days, setDays] = useState(7)
  const retention = useFailureRetention(current.id).data ?? null
  // Nothing older than the workspace keeps failures exists, so those periods would only be empty.
  const periods = PERIODS.filter((p) => retention === null || p.days <= retention || p.days <= 7)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['failures', current.id, kind, shopId, days, page],
    placeholderData: (prev) => prev,
    refetchInterval: 10_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_failures', {
        p_org: current.id,
        p_kind: kind || null,
        p_integration: shopId || null,
        p_days: days,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      const rows = (data ?? []) as Failure[]
      return { rows, total: Number(rows[0]?.total_count ?? 0) }
    },
  })

  useEffect(() => setOpen(null), [kind, shopId, days, page])

  const total = query.data?.total ?? 0
  const period = PERIODS.find((p) => p.days === days)!.label.toLowerCase()

  return (
    <>
      <PageHeader
        title="Failures"
        description="Everything that went wrong, with what it means and what to do: events a shop sent that WorkRelay could not accept, and automation runs that failed. Open a row for the full explanation."
      />
      <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
        <Segmented label="Kind of failure" value={kind} options={KINDS} onChange={(k) => { setKind(k); setPage(0) }} />
        {shops.length > 1 && (
          <Select aria-label="Shop" className="w-auto min-w-40" value={shopId} onChange={(e) => { setShopId(e.target.value); setPage(0) }}>
            <option value="">All shops</option>
            {shops.map((i) => <option key={i.id} value={i.id}>{shopLabel(i)}</option>)}
          </Select>
        )}
        <Select aria-label="Period" className="w-auto min-w-40" value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(0) }}>
          {periods.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
        </Select>
        {shopId && <p className="text-xs text-muted-foreground">Automation runs belong to no single shop, so they are not listed while a shop is chosen.</p>}
        {retention !== null && (
          <p className="ml-auto text-xs text-muted-foreground">
            Failures are kept for {retention} {retention === 1 ? 'day' : 'days'}, then removed. <Link to="/settings" className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Change this in Settings</Link>.
          </p>
        )}
      </Card>
      <Card>
        {query.isLoading ? (
          <TableSkeleton rows={8} />
        ) : query.error ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : query.data!.rows.length === 0 ? (
          <EmptyState icon={CircleCheck} title={`Nothing failed in the ${period}`} description="When a shop sends something WorkRelay cannot accept, or an automation run fails, it is listed here with the reason and what to do." />
        ) : (
          <>
            <p className="border-b px-4 py-3 text-xs text-muted-foreground" role="status">
              <span className="font-medium text-foreground tabular-nums">{total.toLocaleString()}</span> {total === 1 ? 'failure' : 'failures'} in the {period}, newest first.
            </p>
            <Table>
              <THead>
                <tr>
                  <TH className="w-8"><span className="sr-only">Show details</span></TH>
                  <TH>When</TH>
                  <TH>What failed</TH>
                  <TH className="hidden md:table-cell">Shop</TH>
                  <TH>What happened</TH>
                </tr>
              </THead>
              <tbody>
                {query.data!.rows.map((f) => {
                  const isOpen = open === f.id
                  const x = explainFailure(f.kind, f.error)
                  return (
                    <Fragment key={f.id}>
                      <TR>
                        <TD className="w-8 pr-0 align-top">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Hide' : 'Show'} the explanation`}
                            onClick={() => setOpen(isOpen ? null : f.id)}
                            className="mt-0.5 grid size-6 place-items-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                          </button>
                        </TD>
                        <TD className="whitespace-nowrap align-top" title={formatDateTime(f.at)}>
                          <span className="font-medium">{timeAgo(f.at)}</span>
                          <div className="text-[11px] text-muted-foreground">{formatDateTime(f.at)}</div>
                        </TD>
                        <TD className="align-top">
                          <Badge tone={f.kind === 'event' ? 'warning' : 'danger'}>{f.kind === 'event' ? 'Incoming event' : 'Automation run'}</Badge>
                          <div className="mt-1 max-w-48 truncate font-mono text-[11px] text-muted-foreground" title={f.subject}>{f.subject}</div>
                        </TD>
                        <TD className="hidden align-top text-muted-foreground md:table-cell [overflow-wrap:anywhere]">{f.integration_name ?? '—'}</TD>
                        <TD className="min-w-56 align-top">
                          <div className="font-medium">{x.title}</div>
                          <div className="mt-0.5 line-clamp-2 max-w-[60ch] text-muted-foreground">{x.reason}</div>
                        </TD>
                      </TR>
                      {isOpen && (
                        <tr className="border-b bg-muted/30 last:border-0">
                          <td />
                          <td colSpan={4} className="px-3 py-4 sm:px-4"><Details f={f} /></td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
