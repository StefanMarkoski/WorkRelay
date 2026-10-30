import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
import type { Product, ProductOrder, StockEvent } from '@/types/db'

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
        .limit(20)
      if (error) throw error
      return (data ?? []) as StockEvent[]
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
                  {history.data!.map((e) => (
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
