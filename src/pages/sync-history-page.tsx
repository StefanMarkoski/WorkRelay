import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, History } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { useIntegrations } from '@/features/integrations/queries'
import { CONFLICT_STATUS_LABEL } from '@/features/stock-push/queries'
import { RequestItems } from '@/features/stock-push/request-items'
import { shopLabel } from '@/features/integrations/shop-label'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, formatMoney, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { SyncChange, SyncRun, SyncRunConflict } from '@/types/db'

const PAGE_SIZE = 25

type SortKey = 'time' | 'source' | 'shop' | 'by' | 'products' | 'changes' | 'result'

/** Which way the numbers went, and how. */
const DIRECTION: Record<SyncRun['source'], { main: string; sub: string }> = {
  push: { main: 'Shop → WorkRelay', sub: 'The shop pushed its numbers' },
  pull: { main: 'Shop → WorkRelay', sub: 'WorkRelay read the shop' },
  send: { main: 'WorkRelay → Shop', sub: 'Stock numbers sent' },
}

/** Who or what started it, in words. A push says who pressed the button in the shop, when the shop told us. */
function startedBy(r: SyncRun): string {
  if (r.source === 'send') return 'Automatic'
  if (r.source === 'pull') {
    if (r.trigger === 'manual') return 'Sync now'
    if (r.trigger === 'before_push') return 'Before sending'
    if (r.trigger === 'after_push') return 'Check after sending'
    return 'Schedule'
  }
  if (!r.by_name) return '—'
  return r.by_role ? `${r.by_name} (${r.by_role})` : r.by_name
}

function SortHead({ id, label, sort, desc, onSort, className }: { id: SortKey; label: string; sort: SortKey; desc: boolean; onSort: (k: SortKey) => void; className?: string }) {
  const on = sort === id
  return (
    <TH className={className} aria-sort={on ? (desc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(id)}
        className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', on && 'text-foreground')}
      >
        {label}
        {on ? desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden /> : <span className="size-3" aria-hidden />}
      </button>
    </TH>
  )
}

/** "10.00 MKD" for a price that appeared, "10.00 MKD → 12.00 MKD" for one that moved, a dash when the sync left the price alone. */
function priceChange(c: SyncChange): string {
  if (c.price_after === null) return '—'
  const after = formatMoney(c.price_after, c.currency_after)
  return c.price_before === null ? after : `${formatMoney(c.price_before, c.currency_before)} → ${after}`
}

/** The disagreements one read of the shop opened, and what was decided about each: which number was kept. */
function Disagreements({ run }: { run: SyncRun }) {
  const q = useQuery({
    queryKey: ['sync-run', run.id, 'conflicts'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sync_run_conflicts', { p_run: run.id })
      if (error) throw error
      return (data ?? []) as SyncRunConflict[]
    },
  })
  if (q.isLoading) return null
  if (q.error) return <p className="mt-3 text-sm text-muted-foreground">Could not load the disagreements. Close this row and open it again.</p>
  const rows = q.data ?? []
  if (rows.length === 0) return null
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium">
        {rows.length.toLocaleString()} disagreement{rows.length === 1 ? '' : 's'}: the shop&apos;s number was not what WorkRelay believed. Nothing was overwritten.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 text-right font-medium">WorkRelay said</th><th className="px-3 py-2 text-right font-medium">The shop said</th><th className="px-3 py-2 font-medium">Decided</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.sku} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium [overflow-wrap:anywhere]">{c.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{c.sku}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{c.workrelay_value.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c.shop_value.toLocaleString()}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {CONFLICT_STATUS_LABEL[c.status]}{c.decided_at ? ` · ${timeAgo(c.decided_at)}` : ''}
                  {c.status === 'open' && <Link to="/inventory/pushes" className="ml-2 font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Decide</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** What one sync changed, fetched when the row is opened. A request sent to the shop shows the numbers it carried instead. */
function Changes({ run }: { run: SyncRun }) {
  const q = useQuery({
    queryKey: ['sync-run', run.id, 'changes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sync_run_changes', { p_run: run.id, p_limit: 100 })
      if (error) throw error
      return (data ?? []) as SyncChange[]
    },
  })
  if (run.source === 'send') return <RequestItems id={run.id} error={run.status === 'ok' ? null : run.error} />
  if (run.status === 'failed') {
    return (
      <p className="text-sm">
        <span className="font-medium">Nothing was applied.</span> <span className="text-muted-foreground [overflow-wrap:anywhere]">{run.error}</span>
      </p>
    )
  }
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (q.error) return <p className="text-sm text-muted-foreground">Could not load the changes. Close this row and open it again.</p>
  const rows = q.data ?? []
  if (rows.length === 0) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">
          {run.received === 0 ? 'The shop sent an empty list, so nothing could change.' : `All ${run.received.toLocaleString()} product${run.received === 1 ? '' : 's'} already had these numbers: no stock moved, no price changed and nothing new was added.`}
        </p>
        {run.issues > 0 && <Disagreements run={run} />}
      </div>
    )
  }
  const more = (rows[0]?.total_count ?? 0) - rows.length
  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {run.changed.toLocaleString()} of {run.received.toLocaleString()} product{run.received === 1 ? '' : 's'} changed: new, or their stock or price changed.
        {run.received > run.changed ? ` The other ${(run.received - run.changed).toLocaleString()} had the same stock and price as before.` : ''}
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 text-right font-medium">Stock before</th><th className="px-3 py-2 text-right font-medium">Stock after</th><th className="px-3 py-2 text-right font-medium">Price</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.sku} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium [overflow-wrap:anywhere]">{c.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{c.sku}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{c.stock_after === null ? '—' : c.stock_before === null ? 'new' : c.stock_before.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{c.stock_after === null ? '—' : c.stock_after.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{priceChange(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mt-2 text-xs text-muted-foreground">Plus {more.toLocaleString()} more. The biggest changes are shown first.</p>}
      {run.issues > 0 && <Disagreements run={run} />}
    </div>
  )
}

export function SyncHistoryPage() {
  const { current } = useWorkspace()
  const integrations = useIntegrations()
  const shops = integrations.data ?? []
  const [shopId, setShopId] = useState('')
  const [sort, setSort] = useState<SortKey>('time')
  const [desc, setDesc] = useState(true)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['sync-runs', current.id, shopId, sort, desc, page],
    placeholderData: (prev) => prev,
    refetchInterval: 15_000, // a sync that just ran shows up without a reload
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_sync_runs', {
        p_org: current.id,
        p_integration: shopId || null,
        p_sort: sort,
        p_desc: desc,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      const rows = (data ?? []) as SyncRun[]
      return { rows, total: Number(rows[0]?.total_count ?? 0) }
    },
  })

  useEffect(() => setOpen(null), [shopId, sort, desc, page])

  function onSort(k: SortKey) {
    // the first click on a column sorts it the way people expect: newest and biggest first, names A to Z
    if (k === sort) setDesc(!desc)
    else { setSort(k); setDesc(k === 'time' || k === 'products' || k === 'changes') }
    setPage(0)
  }

  return (
    <>
      <Link to="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Inventory
      </Link>
      <PageHeader
        title="Sync history"
        description="Every time numbers moved between your shop and WorkRelay, newest first: the shop's numbers coming to WorkRelay (pushed by the shop, or read by WorkRelay, including the quiet read before it sends) and WorkRelay's numbers going to the shop. Open a row to see what changed, any disagreement, and which number was kept. Kept for 30 days."
      />
      {shops.length > 1 && (
        <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
          <Select aria-label="Shop" className="w-auto min-w-40" value={shopId} onChange={(e) => { setShopId(e.target.value); setPage(0) }}>
            <option value="">All shops</option>
            {shops.map((i) => <option key={i.id} value={i.id}>{shopLabel(i)}</option>)}
          </Select>
        </Card>
      )}
      <Card>
        {query.isLoading ? (
          <TableSkeleton rows={8} />
        ) : query.error ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : query.data!.rows.length === 0 ? (
          <EmptyState
            icon={History}
            title="No syncs yet"
            description="When a shop pushes its products, WorkRelay reads a shop, or WorkRelay sends a shop its stock numbers, it is listed here with what changed. Syncs older than 30 days are removed."
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH className="w-8"><span className="sr-only">Show changes</span></TH>
                  <SortHead id="time" label="When" sort={sort} desc={desc} onSort={onSort} />
                  <SortHead id="source" label="Direction" sort={sort} desc={desc} onSort={onSort} />
                  <SortHead id="shop" label="Shop" sort={sort} desc={desc} onSort={onSort} />
                  <SortHead id="by" label="Started by" sort={sort} desc={desc} onSort={onSort} className="hidden md:table-cell" />
                  <SortHead id="products" label="Products" sort={sort} desc={desc} onSort={onSort} className="text-right" />
                  <SortHead id="changes" label="Changed" sort={sort} desc={desc} onSort={onSort} className="hidden text-right sm:table-cell" />
                  <TH className="hidden text-right md:table-cell">Issues</TH>
                  <SortHead id="result" label="Result" sort={sort} desc={desc} onSort={onSort} />
                </tr>
              </THead>
              <tbody>
                {query.data!.rows.map((r) => {
                  const isOpen = open === r.id
                  return (
                    <Fragment key={r.id}>
                      <TR>
                        <TD className="w-8 pr-0">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Hide' : 'Show'} what this sync changed`}
                            onClick={() => setOpen(isOpen ? null : r.id)}
                            className="grid size-6 place-items-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                          </button>
                        </TD>
                        <TD className="whitespace-nowrap" title={formatDateTime(r.created_at)}>
                          <span className="font-medium">{timeAgo(r.created_at)}</span>
                          <div className="text-[11px] text-muted-foreground">{formatDateTime(r.created_at)}</div>
                        </TD>
                        <TD className="whitespace-nowrap">
                          <span className="font-medium">{DIRECTION[r.source].main}</span>
                          <div className="text-[11px] text-muted-foreground">{DIRECTION[r.source].sub}</div>
                        </TD>
                        <TD className="min-w-28 [overflow-wrap:anywhere]">{r.integration_name}</TD>
                        <TD className="hidden md:table-cell [overflow-wrap:anywhere]">{startedBy(r)}</TD>
                        <TD className="text-right tabular-nums">{r.status === 'failed' ? '—' : r.received.toLocaleString()}</TD>
                        <TD className="hidden text-right tabular-nums sm:table-cell">{r.status === 'failed' ? '—' : r.changed.toLocaleString()}</TD>
                        <TD className="hidden text-right tabular-nums md:table-cell">{r.issues > 0 ? <Badge tone="warning">{r.issues.toLocaleString()}</Badge> : '—'}</TD>
                        <TD><Badge tone={r.status === 'ok' ? 'success' : r.status === 'cancelled' ? 'neutral' : 'danger'}>{r.status === 'ok' ? 'OK' : r.status === 'cancelled' ? 'Not sent' : 'Failed'}</Badge></TD>
                      </TR>
                      {isOpen && (
                        <tr className="border-b bg-muted/30 last:border-0">
                          <td />
                          <td colSpan={8} className="px-3 py-4 sm:px-4">
                            <Changes run={r} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
