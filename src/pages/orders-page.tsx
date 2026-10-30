import { useQuery } from '@tanstack/react-query'
import { Search, ShoppingCart, Store } from 'lucide-react'
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
import { shopLabel } from '@/features/integrations/shop-label'
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
        .select('*, integrations(name, currency)', { count: 'exact' })
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
      <Card className="mb-6 space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search orders"
              placeholder="Search order, customer, email…"
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
            {integrations.data?.map((i) => <option key={i.id} value={i.id}>{shopLabel(i)}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-3 border-t pt-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Date:</span>
            <Input aria-label="Placed from" type="date" className="h-8 w-auto text-xs" value={filters.from} onChange={set('from')} />
            <span className="text-muted-foreground">—</span>
            <Input aria-label="Placed until" type="date" className="h-8 w-auto text-xs" value={filters.to} onChange={set('to')} />
          </div>
          <Button variant="ghost" size="sm" disabled={!filtered} onClick={() => { setFilters(EMPTY); setSearchInput(''); setPage(0) }}>
            Reset filters
          </Button>
        </div>
      </Card>

      <Card>
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
                  <TH>Order</TH><TH className="hidden sm:table-cell">Customer</TH><TH className="hidden lg:table-cell">Date</TH><TH className="text-right">Total</TH>
                  <TH>Payment</TH><TH className="hidden lg:table-cell">Fulfillment</TH><TH className="hidden lg:table-cell">Source</TH><TH className="hidden lg:table-cell">Updated</TH>
                </tr>
              </THead>
              <tbody>
                {query.data!.rows.map((o) => (
                  <TR key={o.id}>
                    <TD className="min-w-28">
                      <Link to={`/orders/${o.id}`} className="inline-block max-w-60 align-top font-medium [overflow-wrap:anywhere] text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
                        {o.order_number ?? `#${o.external_id}`}
                      </Link>
                      <div className="mt-0.5 max-w-36 truncate text-[11px] text-muted-foreground sm:hidden" title={o.customer_name ?? undefined}>{o.customer_name ?? ''}</div>
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <div className="font-medium">{o.customer_name ?? '—'}</div>
                      <div className="text-[11px] text-muted-foreground">{o.customer_email ?? ''}</div>
                    </TD>
                    <TD className="hidden whitespace-nowrap lg:table-cell">{formatDate(o.placed_at)}</TD>
                    <TD className="text-right font-medium tabular-nums">{formatMoney(o.total_minor, o.currency)}</TD>
                    <TD><StatusBadge status={o.payment_status} /></TD>
                    <TD className="hidden lg:table-cell"><StatusBadge status={o.fulfillment_status} /></TD>
                    <TD className="hidden lg:table-cell">{o.integrations?.name ? <span className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-0.5 text-xs whitespace-nowrap"><Store className="size-3 text-muted-foreground" />{shopLabel(o.integrations)}</span> : '—'}</TD>
                    <TD className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{timeAgo(o.updated_at)}</TD>
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
