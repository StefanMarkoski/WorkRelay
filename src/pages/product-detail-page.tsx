import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChartCard } from '@/components/charts/chart-card'
import { formatFull } from '@/components/charts/scale'
import { StepChart } from '@/components/charts/step-chart'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { NotifyEdit } from '@/features/inventory/notify-edit'
import { PRICE_SOURCE_LABEL } from '@/features/inventory/price-source'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDate, formatDateTime, formatMoney, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Product, ProductOrder, ProductSibling, StockEvent } from '@/types/db'

const PAGE_SIZE = 25

const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="min-w-0 px-4 py-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="mt-1 text-sm font-medium [overflow-wrap:anywhere]">{children}</div>
  </div>
)

export function ProductDetailPage() {
  const { id } = useParams()
  const { current, canManage } = useWorkspace()
  const [page, setPage] = useState(0)
  const [now] = useState(() => Date.now()) // the right edge of the stock chart

  const profile = useQuery({
    queryKey: ['product', id, 'profile'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_products', { p_org: current.id, p_id: id })
      if (error) throw error
      return ((data ?? []) as Product[])[0] ?? null
    },
  })

  const history = useQuery({
    queryKey: ['product', id, 'stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stock_events')
        .select('id, stock_before, stock_after, source, occurred_at')
        .eq('product_id', id)
        .order('occurred_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as StockEvent[]
    },
  })

  // The same SKU in the workspace's other shops (empty for a single-shop workspace or a SKU only one shop has).
  const siblings = useQuery({
    queryKey: ['product', id, 'siblings'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('product_siblings', { p_product: id })
      if (error) throw error
      return (data ?? []) as ProductSibling[]
    },
  })

  const orders = useQuery({
    queryKey: ['product', id, 'orders', page],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('product_orders', { p_product: id, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE })
      if (error) throw error
      const rows = (data ?? []) as ProductOrder[]
      return { rows, total: rows[0]?.total_count ?? 0 }
    },
  })

  if (profile.isLoading) return <TableSkeleton rows={6} />
  if (profile.error) return <ErrorState onRetry={() => profile.refetch()} />
  const p = profile.data
  if (!p) return <ErrorState message="Product not found." />

  return (
    <>
      <Link to="/inventory" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Inventory
      </Link>
      <PageHeader title={p.name} description={`SKU ${p.sku} · ${p.integration_name}`} actions={p.low ? <Badge tone="warning">Low stock</Badge> : undefined} />

      <Card className="mb-4">
        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <Fact label="In stock">
            {p.stock === null ? <span className="text-muted-foreground">Not reported by the shop</span> : <span className="tabular-nums">{p.stock.toLocaleString()}{p.unit ? ` ${p.unit}` : ''}</span>}
          </Fact>
          <Fact label="Notify on"><NotifyEdit product={p} canEdit={canManage} /></Fact>
          <Fact label="Price">
            {p.price_minor === null ? '—' : (
              <>
                <span className="tabular-nums">{formatMoney(p.price_minor, p.currency)}</span>
                {p.price_source && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{PRICE_SOURCE_LABEL[p.price_source]}</span>}
              </>
            )}
          </Fact>
          <Fact label="Sold in 30 days"><span className="tabular-nums">{p.sold_30d.toLocaleString()}</span></Fact>
        </div>
        <CardBody className="space-y-1 border-t text-sm">
          {p.category && <p className="text-muted-foreground">Category <span className="ml-2 text-foreground">{p.category}</span></p>}
          {p.barcode && <p className="text-muted-foreground">Barcode <span className="ml-2 font-mono text-xs text-foreground">{p.barcode}</span></p>}
          <p className="text-muted-foreground">Last reported by the shop <span className="ml-2 text-foreground">{p.reported_at ? formatDateTime(p.reported_at) : 'Never'}</span></p>
          <p className="pt-1 text-xs text-muted-foreground">
            Sales leave out cancelled orders. The price is the shop's own when it reports one, otherwise the latest price on an order.
          </p>
        </CardBody>
      </Card>

      {(siblings.data?.length ?? 0) > 0 && (() => {
        const rows = [{ id: p.id, integration_name: p.integration_name, stock: p.stock, unit: p.unit, low: p.low, here: true }, ...siblings.data!.map((x) => ({ ...x, here: false }))]
        const known = rows.filter((r) => r.stock !== null)
        const total = known.reduce((n, r) => n + (r.stock ?? 0), 0)
        return (
          <Card className="mb-4">
            <CardHeader><CardTitle>Same SKU in your shops</CardTitle></CardHeader>
            <Table>
              <THead><tr><TH>Shop</TH><TH className="text-right">In stock</TH></tr></THead>
              <tbody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="[overflow-wrap:anywhere]">
                      {r.here ? <span className="font-medium">{r.integration_name}</span> : <Link to={`/inventory/${r.id}`} className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">{r.integration_name}</Link>}
                      {r.here && <span className="ml-2 text-xs text-muted-foreground">this product</span>}
                    </TD>
                    <TD className="text-right">
                      {r.stock === null ? <span className="text-xs text-muted-foreground">Not reported</span> : (
                        <span className="inline-flex items-center justify-end gap-2">
                          {r.low && <Badge tone="warning">Low</Badge>}
                          <span className="font-medium tabular-nums">{r.stock.toLocaleString()}{r.unit ? ` ${r.unit}` : ''}</span>
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
                <TR>
                  <TD className="font-medium">Total</TD>
                  <TD className="text-right font-medium tabular-nums">{known.length > 0 ? total.toLocaleString() : '—'}</TD>
                </TR>
              </tbody>
            </Table>
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">
              Shops are matched by SKU, so check it means the same product in each.
              {known.length < rows.length ? ' The total leaves out shops that have not reported stock.' : ''} Each shop keeps its own alert level.
            </p>
          </Card>
        )
      })()}

      {(history.data?.length ?? 0) > 1 && (
        <ChartCard
          className="mb-4"
          title="Stock over time"
          description={p.effective_notify_on !== null ? `Pieces on hand each time the shop reported a change. The line marks the alert level (${formatFull(p.effective_notify_on)}).` : 'Pieces on hand each time the shop reported a change.'}
          table={{
            columns: ['When', 'Stock'],
            rows: [...history.data!].reverse().map((e) => [formatDateTime(e.occurred_at), e.stock_after]),
          }}
        >
          <StepChart
            points={[...history.data!].reverse().map((e) => ({ t: new Date(e.occurred_at).getTime(), v: e.stock_after }))}
            now={now}
            threshold={p.effective_notify_on !== null ? { value: p.effective_notify_on, label: `Notify on ${formatFull(p.effective_notify_on)}` } : undefined}
            formatValue={(n) => `${formatFull(n)}${p.unit ? ` ${p.unit}` : ''}`}
            label={`Stock of ${p.name} over time`}
          />
        </ChartCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Stock history</CardTitle></CardHeader>
          {history.isLoading ? <TableSkeleton rows={3} /> : history.error ? <ErrorState onRetry={() => history.refetch()} /> :
            history.data!.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No stock numbers received yet. Changes appear here as the shop reports them.</p>
            ) : (
              <Table>
                <THead><tr><TH>When</TH><TH className="text-right">From</TH><TH className="text-right">To</TH><TH className="hidden sm:table-cell">Via</TH></tr></THead>
                <tbody>
                  {history.data!.slice(0, 20).map((e) => (
                    <TR key={e.id}>
                      <TD className="whitespace-nowrap text-muted-foreground" title={formatDateTime(e.occurred_at)}>{timeAgo(e.occurred_at)}</TD>
                      <TD className="text-right tabular-nums text-muted-foreground">{e.stock_before === null ? '—' : e.stock_before.toLocaleString()}</TD>
                      <TD className="text-right font-medium tabular-nums">{e.stock_after.toLocaleString()}</TD>
                      <TD className="hidden text-muted-foreground sm:table-cell">{e.source === 'push' ? 'Pushed by the shop' : 'Scheduled check'}</TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
        </Card>

        <Card>
          <CardHeader><CardTitle>Orders with this product</CardTitle></CardHeader>
          {orders.isLoading ? <TableSkeleton rows={3} /> : orders.error ? <ErrorState onRetry={() => orders.refetch()} /> :
            orders.data!.total === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No orders contain this product yet.</p>
            ) : (
              <>
                <Table>
                  <THead><tr><TH>Order</TH><TH className="hidden sm:table-cell">Date</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit price</TH><TH>Status</TH></tr></THead>
                  <tbody>
                    {orders.data!.rows.map((o) => (
                      <TR key={o.id}>
                        <TD className="min-w-24">
                          <Link to={`/orders/${o.id}`} className="font-medium whitespace-nowrap text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
                            {o.order_number ?? `#${o.external_id}`}
                          </Link>
                        </TD>
                        <TD className="hidden whitespace-nowrap sm:table-cell">{formatDate(o.placed_at)}</TD>
                        <TD className="text-right tabular-nums">{o.quantity.toLocaleString()}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(o.unit_price_minor, o.currency)}</TD>
                        <TD><StatusBadge status={o.status} /></TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
                <Pagination page={page} pageSize={PAGE_SIZE} total={orders.data!.total} onPage={setPage} />
              </>
            )}
        </Card>
      </div>
    </>
  )
}
