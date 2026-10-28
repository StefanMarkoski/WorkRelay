import { useQuery } from '@tanstack/react-query'
import { Search, ShoppingCart } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { useIntegrations } from '@/features/integrations/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDate, formatMoney, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Order } from '@/types/db'

const PAGE_SIZE = 25
const EMPTY = { search: '', status: '', payment: '', fulfillment: '', integration: '', from: '', to: '' }
type Filters = typeof EMPTY

/** PostgREST `or()` filters are comma/paren-delimited, so strip those and LIKE wildcards from user input. */
const sanitizeSearch = (s: string) => s.replace(/[,()%*_\\]/g, ' ').trim()

export function OrdersPage() {
  const { current } = useWorkspace()
  const integrations = useIntegrations()
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, search: searchInput }))
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const set = (key: keyof Filters) => (e: { target: { value: string } }) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }))
    setPage(0)
  }

  const query = useQuery({
    queryKey: ['orders', current.id, filters, page],
    placeholderData: (prev) => prev,
    refetchInterval: 30_000, // safety net if live updates are unavailable
    queryFn: async () => {
      let q = supabase
        .from('orders')
        .select('*, integrations(name)', { count: 'exact' })
        .eq('organization_id', current.id)
        .order('placed_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      const term = sanitizeSearch(filters.search)
      if (term) q = q.or(`order_number.ilike.%${term}%,customer_name.ilike.%${term}%,customer_email.ilike.%${term}%,external_id.ilike.%${term}%`)
      if (filters.status) q = q.eq('status', filters.status)
      if (filters.payment) q = q.eq('payment_status', filters.payment)
      if (filters.fulfillment) q = q.eq('fulfillment_status', filters.fulfillment)
      if (filters.integration) q = q.eq('integration_id', filters.integration)
      if (filters.from) q = q.gte('placed_at', new Date(filters.from).toISOString())
      if (filters.to) q = q.lt('placed_at', new Date(new Date(filters.to).getTime() + 86_400_000).toISOString())
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as unknown as Order[], total: count ?? 0 }
    },
  })

  const filtered = Object.entries(filters).some(([, v]) => v !== '')

  return (
    <>
      <PageHeader title="Orders" description="Orders received from your connected stores." />
      <Card>
        <div className="grid gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <div className="relative sm:col-span-2">
            <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Search orders"
              placeholder="Order, customer or email"
              className="pl-8"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Select aria-label="Order status" value={filters.status} onChange={set('status')}>
            <option value="">Any status</option>
            {['pending', 'processing', 'completed', 'cancelled', 'unknown'].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select aria-label="Payment status" value={filters.payment} onChange={set('payment')}>
            <option value="">Any payment</option>
            {['unpaid', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed', 'unknown'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </Select>
          <Select aria-label="Fulfillment status" value={filters.fulfillment} onChange={set('fulfillment')}>
            <option value="">Any fulfillment</option>
            {['unfulfilled', 'partial', 'fulfilled', 'returned', 'unknown'].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select aria-label="Source integration" value={filters.integration} onChange={set('integration')}>
            <option value="">Any source</option>
            {integrations.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <div className="flex items-center gap-1 sm:col-span-2 lg:col-span-2">
            <Input aria-label="Placed from" type="date" value={filters.from} onChange={set('from')} />
            <span className="text-muted-foreground">–</span>
            <Input aria-label="Placed until" type="date" value={filters.to} onChange={set('to')} />
          </div>
          {filtered && (
            <Button variant="ghost" onClick={() => { setFilters(EMPTY); setSearchInput(''); setPage(0) }}>Clear filters</Button>
          )}
        </div>

        {query.isLoading ? (
          <TableSkeleton rows={8} />
        ) : query.error ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : query.data!.rows.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title={filtered ? 'No orders match these filters' : 'No orders yet'}
            description={filtered ? 'Try widening the date range or clearing a filter.' : 'Orders appear here once a connected store starts sending events.'}
            action={!filtered ? <Link to="/integrations"><Button variant="outline">Go to integrations</Button></Link> : undefined}
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Order</TH><TH>Customer</TH><TH>Date</TH><TH className="text-right">Total</TH>
                  <TH>Payment</TH><TH>Fulfillment</TH><TH>Source</TH><TH>Updated</TH>
                </tr>
              </THead>
              <tbody>
                {query.data!.rows.map((o) => (
                  <TR key={o.id}>
                    <TD>
                      <Link to={`/orders/${o.id}`} className="font-medium text-primary hover:underline">
                        {o.order_number ?? `#${o.external_id}`}
                      </Link>
                    </TD>
                    <TD>
                      <div>{o.customer_name ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{o.customer_email ?? ''}</div>
                    </TD>
                    <TD className="whitespace-nowrap">{formatDate(o.placed_at)}</TD>
                    <TD className="text-right tabular-nums">{formatMoney(o.total_minor, o.currency)}</TD>
                    <TD><StatusBadge status={o.payment_status} /></TD>
                    <TD><StatusBadge status={o.fulfillment_status} /></TD>
                    <TD className="text-muted-foreground">{o.integrations?.name ?? '—'}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{timeAgo(o.updated_at)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  )
}
