import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDate, formatDateTime, formatMoney, formatSpent } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Customer, CustomerOrder } from '@/types/db'

const PAGE_SIZE = 25

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0 px-4 py-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-sm font-medium tabular-nums [overflow-wrap:anywhere]">{value}</p>
  </div>
)

export function CustomerDetailPage() {
  const { id } = useParams()
  const { current } = useWorkspace()
  const [page, setPage] = useState(0)

  const profile = useQuery({
    queryKey: ['customer', id, 'profile'],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_customers', { p_org: current.id, p_id: id })
      if (error) throw error
      return ((data ?? []) as Customer[])[0] ?? null
    },
  })

  const orders = useQuery({
    queryKey: ['customer', id, 'orders', page],
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('customer_orders', { p_customer: id, p_limit: PAGE_SIZE, p_offset: page * PAGE_SIZE })
      if (error) throw error
      const rows = (data ?? []) as CustomerOrder[]
      return { rows, total: rows[0]?.total_count ?? 0 }
    },
  })

  if (profile.isLoading) return <TableSkeleton rows={6} />
  if (profile.error) return <ErrorState onRetry={() => profile.refetch()} />
  const c = profile.data
  if (!c) return <ErrorState message="Customer not found." />

  return (
    <>
      <Link to="/customers" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <PageHeader title={c.name ?? c.email} description={c.name ? c.email : 'Name not provided by the store'} />

      <Card className="mb-4">
        <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <Fact label="Orders" value={c.order_count.toLocaleString()} />
          <Fact label="Order value" value={formatSpent(c.spent)} />
          <Fact label="First seen" value={formatDate(c.first_seen_at)} />
          <Fact label="Last order" value={formatDateTime(c.last_order_at)} />
        </div>
        <CardBody className="space-y-1 border-t text-sm">
          <p className="text-muted-foreground">Email <span className="ml-2 text-foreground [overflow-wrap:anywhere]">{c.email}</span></p>
          {c.registered_at && <p className="text-muted-foreground">Signed up <span className="ml-2 text-foreground">{formatDateTime(c.registered_at)}</span></p>}
          {c.external_id && <p className="text-muted-foreground">Shop customer ID <span className="ml-2 font-mono text-xs text-foreground [overflow-wrap:anywhere]">{c.external_id}</span></p>}
          {c.phone && <p className="text-muted-foreground">Phone <span className="ml-2 text-foreground [overflow-wrap:anywhere]">{c.phone}</span></p>}
          <p className="pt-1 text-xs text-muted-foreground">Order value adds up each currency separately and leaves out cancelled orders.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Order history</CardTitle></CardHeader>
        {orders.isLoading ? (
          <TableSkeleton rows={4} />
        ) : orders.error ? (
          <ErrorState onRetry={() => orders.refetch()} />
        ) : (
          orders.data!.total === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No orders yet. This customer signed up through the shop but has not placed an order.</p>
          ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Order</TH><TH className="hidden sm:table-cell">Date</TH><TH className="text-right">Total</TH>
                  <TH>Status</TH><TH className="hidden lg:table-cell">Payment</TH><TH className="hidden lg:table-cell">Fulfillment</TH><TH className="hidden lg:table-cell">Source</TH>
                </tr>
              </THead>
              <tbody>
                {orders.data!.rows.map((o) => (
                  <TR key={o.id}>
                    <TD className="min-w-28">
                      <Link to={`/orders/${o.id}`} className="inline-block max-w-60 align-top font-medium [overflow-wrap:anywhere] text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
                        {o.order_number ?? `#${o.external_id}`}
                      </Link>
                    </TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{formatDate(o.placed_at)}</TD>
                    <TD className="text-right font-medium tabular-nums">{formatMoney(o.total_minor, o.currency)}</TD>
                    <TD><StatusBadge status={o.status} /></TD>
                    <TD className="hidden lg:table-cell"><StatusBadge status={o.payment_status} /></TD>
                    <TD className="hidden lg:table-cell"><StatusBadge status={o.fulfillment_status} /></TD>
                    <TD className="hidden lg:table-cell">{o.integration_name ?? '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={orders.data!.total} onPage={setPage} />
          </>
          )
        )}
      </Card>
    </>
  )
}
