import { useQuery } from '@tanstack/react-query'
import { Search, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { useIntegrations } from '@/features/integrations/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDate, formatSpent, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Customer } from '@/types/db'

const PAGE_SIZE = 25

type Scope = 'ordered' | 'registered' | 'all'
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'ordered', label: 'Placed an order' },
  { id: 'registered', label: 'Registered only' },
  { id: 'all', label: 'All' },
]

export function CustomersPage() {
  const { current } = useWorkspace()
  const integrations = useIntegrations()
  const [scope, setScope] = useState<Scope>('ordered')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  const query = useQuery({
    queryKey: ['customers', current.id, search, scope, page],
    placeholderData: (prev) => prev,
    refetchInterval: 30_000, // safety net if live updates are unavailable
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_customers', {
        p_org: current.id,
        p_search: search || null,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
        p_scope: scope,
      })
      if (error) throw error
      const rows = (data ?? []) as Customer[]
      return { rows, total: rows[0]?.total_count ?? 0 }
    },
  })

  // The extra groups only exist for shops that send signups (or once did), so nobody else sees a filter that is always empty.
  const showScope = scope !== 'ordered' || (integrations.data ?? []).some((i) => i.signups_enabled_at !== null)

  return (
    <>
      <PageHeader title="Customers" description="Everyone who has placed an order, matched by email address. Shops that send signups can also show people who registered but have not ordered." />
      <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
        {showScope && (
          <Segmented label="Which customers" value={scope} options={SCOPES} onChange={(next) => { setScope(next); setPage(0) }} />
        )}
        <div className="relative min-w-56 max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search customers" placeholder="Search name or email…" className="pl-8" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
      </Card>

      <Card>
        {query.isLoading ? (
          <TableSkeleton rows={8} />
        ) : query.error ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : query.data!.rows.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? 'No customers match this search' : scope === 'registered' ? 'No one has registered without ordering' : 'No customers yet'}
            description={search ? 'Try part of the email address or a different spelling.' : scope === 'registered' ? 'People who sign up through a shop that sends signups, and have not ordered yet, appear here.' : 'A customer appears here once an order with an email address arrives. Orders without an email stay under Orders.'}
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Customer</TH><TH className="text-right">Orders</TH><TH className="text-right">Order value</TH>
                  <TH className="hidden sm:table-cell">Last order</TH><TH className="hidden lg:table-cell">First seen</TH>
                </tr>
              </THead>
              <tbody>
                {query.data!.rows.map((c) => (
                  <TR key={c.id}>
                    <TD className="min-w-32">
                      <Link to={`/customers/${c.id}`} className="inline-block max-w-72 align-top font-medium [overflow-wrap:anywhere] text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
                        {c.name ?? c.email}
                      </Link>
                      {c.name && <div className="mt-0.5 max-w-72 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{c.email}</div>}
                      {c.registered_at && <div className="mt-0.5 text-[11px] text-muted-foreground">Signed up {formatDate(c.registered_at)}</div>}
                    </TD>
                    <TD className="text-right tabular-nums">{c.order_count.toLocaleString()}</TD>
                    <TD className="text-right font-medium tabular-nums">{formatSpent(c.spent)}</TD>
                    <TD className="hidden whitespace-nowrap text-muted-foreground sm:table-cell">{timeAgo(c.last_order_at)}</TD>
                    <TD className="hidden whitespace-nowrap text-muted-foreground lg:table-cell">{formatDate(c.first_seen_at)}</TD>
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
