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
import { conflictDiff, useDecidedConflicts, useOpenConflicts, useStockPushStatus } from '@/features/stock-push/queries'
import { RequestItems } from '@/features/stock-push/request-items'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import type { StockConflict, StockPushRequest } from '@/types/db'

const PAGE_SIZE = 25

const REQUEST_TONE: Record<StockPushRequest['status'], BadgeTone> = { ok: 'success', failed: 'danger', cancelled: 'neutral', sending: 'info' }
const REQUEST_LABEL: Record<StockPushRequest['status'], string> = { ok: 'Delivered', failed: 'Failed', cancelled: 'Not sent', sending: 'Sending' }
/** What is waiting to go to a shop and why it has not gone yet: the read of the shop's own numbers first, a difference being double-checked, or the hourly limit. */
function Waiting() {
  const status = useStockPushStatus()
  // a shop with write-back off still shows what it keeps: the numbers the owner chose are not dropped when it goes off
  const rows = (status.data ?? []).filter((s) => s.waiting > 0 || (s.enabled && s.checking > 0))
  if (rows.length === 0) return null
  return (
    <Card className="mb-6">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Waiting to be sent</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">WorkRelay reads a shop&apos;s own numbers before it sends its own, so a number waits for that read.</p>
      </div>
      <ul className="divide-y">
        {rows.map((s) => {
          const limited = s.reads_used >= s.reads_limit && s.resets_at !== null
          return (
            <li key={s.integration_id} className="px-4 py-3 text-sm">
              <span className="font-medium [overflow-wrap:anywhere]">{s.integration_name}</span>
              <span className="text-muted-foreground">
                {s.waiting > 0 ? ` · ${s.waiting.toLocaleString()} number${s.waiting === 1 ? '' : 's'} waiting` : ''}
                {s.checking > 0 ? ` · ${s.checking.toLocaleString()} difference${s.checking === 1 ? '' : 's'} being double-checked in case an order is still on its way (about 90 seconds)` : ''}
              </span>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {!s.enabled
                  ? 'Write-back is off for this shop. The numbers you chose are kept and go out when it is switched on and the shop has been read; a kept decision lapses after 7 days.'
                  : limited
                  ? `The limit for reading this shop is reached (${s.reads_used.toLocaleString()} of ${s.reads_limit.toLocaleString()} this hour). Numbers wait until ${formatDateTime(s.resets_at!)}.`
                  : `Reads of this shop this hour: ${s.reads_used.toLocaleString()} of ${s.reads_limit.toLocaleString()}.`}
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/** Which number a settled conflict kept, in words. */
const KEPT: Record<Exclude<StockConflict['status'], 'open'>, { label: string; tone: BadgeTone }> = {
  sent_workrelay: { label: 'WorkRelay\'s number', tone: 'info' },
  kept_shop: { label: 'The shop\'s number', tone: 'neutral' },
  agreed: { label: 'Matched on the next report', tone: 'success' },
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

/** Settled conflicts: both numbers and the one that was kept. */
function Decided() {
  const decided = useDecidedConflicts()
  const rows = decided.data ?? []
  if (decided.isLoading || rows.length === 0) return null
  return (
    <Card className="mb-6">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Decided</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Disagreements already settled, newest first, and which number was kept.</p>
      </div>
      <Table>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH className="text-right">WorkRelay said</TH>
            <TH className="text-right">The shop said</TH>
            <TH>Kept</TH>
            <TH className="hidden sm:table-cell">When</TH>
          </tr>
        </THead>
        <tbody>
          {rows.map((c) => {
            const kept = KEPT[c.status as keyof typeof KEPT]
            return (
              <TR key={c.id}>
                <TD className="min-w-40">
                  <span className="font-medium [overflow-wrap:anywhere]">{c.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{c.sku}</span>
                  <div className="text-[11px] text-muted-foreground">{c.integration_name}</div>
                </TD>
                <TD className="text-right tabular-nums">{c.workrelay_value.toLocaleString()}</TD>
                <TD className="text-right tabular-nums">{c.shop_value.toLocaleString()}</TD>
                <TD><Badge tone={kept.tone}>{kept.label}</Badge></TD>
                <TD className="hidden whitespace-nowrap sm:table-cell" title={c.decided_at ? formatDateTime(c.decided_at) : undefined}>{c.decided_at ? timeAgo(c.decided_at) : '—'}</TD>
              </TR>
            )
          })}
        </tbody>
      </Table>
    </Card>
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
        description="Every request WorkRelay sent to a shop with its stock numbers, newest first, and any disagreement between WorkRelay and a shop waiting for the owner. Switch it on per shop, on the shop's Inventory tab. Kept for 30 days."
      />
      <Waiting />
      <Conflicts />
      <Decided />
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
                          <td colSpan={5} className="px-3 py-4 sm:px-4"><RequestItems id={r.id} kind={r.kind} error={r.error} /></td>
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
