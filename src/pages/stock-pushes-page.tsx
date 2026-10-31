import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Send } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { conflictDiff, useOpenConflicts } from '@/features/stock-push/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { StockPushItem, StockPushRequest } from '@/types/db'

const PAGE_SIZE = 25

const REQUEST_TONE: Record<StockPushRequest['status'], BadgeTone> = { ok: 'success', failed: 'danger', cancelled: 'neutral', sending: 'info' }
const REQUEST_LABEL: Record<StockPushRequest['status'], string> = { ok: 'Delivered', failed: 'Failed', cancelled: 'Not sent', sending: 'Sending' }
const ITEM_LABEL: Record<StockPushItem['status'], string> = {
  pending: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Gave up', skipped: 'Skipped', cancelled: 'Not sent',
}

/** The disagreements the owner has to settle: both numbers, the difference, and one button for each side. */
function Conflicts() {
  const { current, isOwner } = useWorkspace()
  const qc = useQueryClient()
  const open = useOpenConflicts()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(id: string, choice: 'shop' | 'workrelay') {
    setBusy(id + choice)
    setError(null)
    const { error: err } = await supabase.rpc('resolve_stock_conflict', { p_conflict: id, p_choice: choice })
    setBusy(null)
    if (err) return setError(errorMessage(err))
    void qc.invalidateQueries({ queryKey: ['stock-conflicts', current.id] })
    void qc.invalidateQueries({ queryKey: ['stock-pushes'] })
  }

  const rows = open.data ?? []
  if (open.isLoading || rows.length === 0) return null
  return (
    <Card className="mb-6">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Needs your decision ({rows.length})</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The shop&apos;s last report disagrees with the number WorkRelay had sent it. Nothing is overwritten until you choose.
          {isOwner ? '' : ' Only the workspace owner can decide.'}
        </p>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH className="text-right">WorkRelay said</TH>
            <TH className="text-right">The shop says</TH>
            <TH className="hidden text-right sm:table-cell">Difference</TH>
            <TH><span className="sr-only">Decision</span></TH>
          </tr>
        </THead>
        <tbody>
          {rows.map((c) => (
            <TR key={c.id}>
              <TD className="min-w-40">
                <span className="font-medium [overflow-wrap:anywhere]">{c.name}</span>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{c.sku}</span>
                <div className="text-[11px] text-muted-foreground">{c.integration_name} · {timeAgo(c.detected_at)}</div>
              </TD>
              <TD className="text-right tabular-nums">{c.workrelay_value.toLocaleString()}</TD>
              <TD className="text-right font-medium tabular-nums">{c.shop_value.toLocaleString()}</TD>
              <TD className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{conflictDiff(c).text}</TD>
              <TD className="text-right">
                {isOwner && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void decide(c.id, 'shop')}>
                      Keep the shop&apos;s {c.shop_value.toLocaleString()}
                    </Button>
                    <Button type="button" size="sm" disabled={busy !== null} onClick={() => void decide(c.id, 'workrelay')}>
                      Send WorkRelay&apos;s {c.workrelay_value.toLocaleString()}
                    </Button>
                  </div>
                )}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
      {error && <p role="alert" className="border-t px-4 py-3 text-xs text-destructive">{error}</p>}
    </Card>
  )
}

/** The SKUs of one request, fetched when the row is opened. */
function Items({ request }: { request: StockPushRequest }) {
  const q = useQuery({
    queryKey: ['stock-pushes', 'items', request.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('stock_push_request_items', { p_request: request.id, p_limit: 100 })
      if (error) throw error
      return (data ?? []) as StockPushItem[]
    },
  })
  if (request.kind === 'test') {
    return <p className="text-sm text-muted-foreground">A signed test. It carries a random code and no stock numbers.{request.error ? ` ${request.error}` : ''}</p>
  }
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (q.error) return <p className="text-sm text-muted-foreground">Could not load the numbers. Close this row and open it again.</p>
  const rows = q.data ?? []
  const more = (rows[0]?.total_count ?? 0) - rows.length
  return (
    <div>
      {request.error && <p className="mb-2 text-sm">{request.error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 text-right font-medium">Number sent</th><th className="px-3 py-2 font-medium">Result</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{r.sku}</span>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{r.stock === null ? '—' : r.stock.toLocaleString()}</td>
                <td className="px-3 py-2 text-muted-foreground">{ITEM_LABEL[r.status]}{r.note ? ` · ${r.note}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mt-2 text-xs text-muted-foreground">Plus {more.toLocaleString()} more.</p>}
    </div>
  )
}

export function StockPushesPage() {
  const { current } = useWorkspace()
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['stock-pushes', current.id, page],
    placeholderData: (prev) => prev,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_stock_pushes', { p_org: current.id, p_integration: null, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE })
      if (error) throw error
      const rows = (data ?? []) as StockPushRequest[]
      return { rows, total: Number(rows[0]?.total_count ?? 0) }
    },
  })

  return (
    <>
      <Link to="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Inventory
      </Link>
      <PageHeader
        title="Stock pushes"
        description="Every request WorkRelay sent to a shop with its stock numbers, newest first, and any disagreement between WorkRelay and a shop waiting for the owner. Switch it on per shop under Integrations → Edit. Kept for 30 days."
      />
      <Conflicts />
      <Card>
        {query.isLoading ? (
          <TableSkeleton rows={6} />
        ) : query.error ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : query.data!.rows.length === 0 ? (
          <EmptyState
            icon={Send}
            title="Nothing sent yet"
            description="When write-back is on for a shop, each change to a product's estimated stock is sent to the shop and listed here. Tests are listed too."
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH className="w-8"><span className="sr-only">Show numbers</span></TH>
                  <TH>When</TH>
                  <TH>Shop</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Products</TH>
                  <TH>Result</TH>
                </tr>
              </THead>
              <tbody>
                {query.data!.rows.map((r) => {
                  const isOpen = openId === r.id
                  return (
                    <Fragment key={r.id}>
                      <TR>
                        <TD className="w-8 pr-0">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Hide' : 'Show'} what this request carried`}
                            onClick={() => setOpenId(isOpen ? null : r.id)}
                            className="grid size-6 place-items-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight className={cn('size-4 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                          </button>
                        </TD>
                        <TD className="whitespace-nowrap" title={formatDateTime(r.created_at)}>
                          <span className="font-medium">{timeAgo(r.created_at)}</span>
                          <div className="text-[11px] text-muted-foreground">{formatDateTime(r.created_at)}</div>
                        </TD>
                        <TD className="min-w-28 [overflow-wrap:anywhere]">{r.integration_name}</TD>
                        <TD className="whitespace-nowrap">{r.kind === 'test' ? 'Test' : 'Stock numbers'}</TD>
                        <TD className="text-right tabular-nums">{r.kind === 'test' ? '—' : r.item_count.toLocaleString()}</TD>
                        <TD>
                          <Badge tone={REQUEST_TONE[r.status]}>{REQUEST_LABEL[r.status]}</Badge>
                          {r.http_status ? <span className="ml-2 text-[11px] text-muted-foreground">HTTP {r.http_status}</span> : null}
                        </TD>
                      </TR>
                      {isOpen && (
                        <tr className="border-b bg-muted/30 last:border-0">
                          <td />
                          <td colSpan={5} className="px-3 py-4 sm:px-4"><Items request={r} /></td>
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
