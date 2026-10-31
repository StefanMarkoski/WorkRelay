import { useQuery } from '@tanstack/react-query'
import { Boxes, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input, Select } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { InventoryHealthCard } from '@/features/insights/cards'
import { useInventoryHealth } from '@/features/insights/queries'
import { NotifyEdit } from '@/features/inventory/notify-edit'
import { PRICE_SOURCE_LABEL } from '@/features/inventory/price-source'
import { useIntegrations } from '@/features/integrations/queries'
import { ShopFreshness } from '@/features/integrations/shop-freshness'
import { SyncNowControl } from '@/features/integrations/sync-now-button'
import { shopLabel } from '@/features/integrations/shop-label'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatMoney, timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useStockEstimates } from '@/features/inventory/estimates'
import type { Product } from '@/types/db'

const PAGE_SIZE = 25

type Scope = 'all' | 'low'
const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: 'All products' },
  { id: 'low', label: 'Low stock' },
]

export function InventoryPage() {
  const { current, canManage } = useWorkspace()
  const integrations = useIntegrations()
  const [shopId, setShopId] = useState('') // '' = all shops together
  const [scope, setScope] = useState<Scope>('all')
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
    queryKey: ['products', current.id, search, scope, shopId, page],
    placeholderData: (prev) => prev,
    refetchInterval: 30_000, // stock changes arrive from the shop; this keeps the page fresh without a reload
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_products', {
        p_org: current.id,
        p_search: search || null,
        p_integration: shopId || null,
        p_low_only: scope === 'low',
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      })
      if (error) throw error
      const rows = (data ?? []) as Product[]
      return { rows, total: rows[0]?.total_count ?? 0 }
    },
  })

  const shops = integrations.data ?? []
  const estimates = useStockEstimates(current.id, (query.data?.rows ?? []).map((r) => r.id)).data
  const health = useInventoryHealth(shopId).data
  const hasProducts = !!health && health.low + health.ok + health.no_threshold + health.not_reported > 0

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Your products and how many pieces are left, as reported by each shop. Products also appear here once they show up on an order."
      />
      {hasProducts && (
        <Card className="mb-6 p-4">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Stock levels{shopId ? '' : shops.length > 1 ? ' across all shops' : ''}</p>
          <InventoryHealthCard shopId={shopId} bare />
        </Card>
      )}
      <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
        <div className="order-last flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t pt-3">
          <ShopFreshness shopId={shopId} />
          <SyncNowControl shopId={shopId} />
        </div>
        {shops.length > 1 && (
          <Select aria-label="Shop" className="w-auto min-w-40" value={shopId} onChange={(e) => { setShopId(e.target.value); setPage(0) }}>
            <option value="">All shops</option>
            {shops.map((i) => <option key={i.id} value={i.id}>{shopLabel(i)}</option>)}
          </Select>
        )}
        <Segmented label="Which products" value={scope} options={SCOPES} onChange={(next) => { setScope(next); setPage(0) }} />
        <div className="relative min-w-56 max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search products" placeholder="Search name or SKU…" className="pl-8" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
      </Card>

      <Card>
        {query.isLoading ? (
          <TableSkeleton rows={8} />
        ) : query.error ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : query.data!.rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={search ? 'No products match this search' : scope === 'low' ? 'Nothing is low on stock' : 'No products yet'}
            description={
              search
                ? 'Try part of the name or SKU.'
                : scope === 'low'
                  ? 'A product shows here when its stock is at or below its "Notify on" number. Products without one never count as low.'
                  : 'Products appear when a shop reports them, or when an order contains an item with a SKU.'
            }
          />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <TH>Product</TH><TH className="text-right">In stock</TH><TH className="text-right">Notify on</TH>
                  <TH className="hidden text-right md:table-cell">Price</TH><TH className="hidden text-right lg:table-cell">Sold, 30 days</TH>
                  <TH className="hidden xl:table-cell">Reported</TH>
                </tr>
              </THead>
              <tbody>
                {query.data!.rows.map((p) => (
                  <TR key={p.id}>
                    <TD className="min-w-40">
                      <Link to={`/inventory/${p.id}`} className="inline-block max-w-72 align-top font-medium [overflow-wrap:anywhere] text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">
                        {p.name}
                      </Link>
                      <div className="mt-0.5 max-w-72 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                        {p.sku}{shops.length > 1 && <span className="font-sans"> · {shopLabel(shops.find((s) => s.id === p.integration_id) ?? { name: p.integration_name })}</span>}
                      </div>
                    </TD>
                    <TD className="text-right">
                      {p.stock === null ? (
                        <span className="text-xs text-muted-foreground">Not reported</span>
                      ) : (
                        <span className="inline-flex items-center justify-end gap-2">
                          {p.low && <Badge tone="warning">Low</Badge>}
                          <span className="font-medium tabular-nums">{p.stock.toLocaleString()}</span>
                        </span>
                      )}
                      {(() => {
                        const est = estimates?.get(p.id)
                        return est && est.sold_since > 0 ? (
                          <div className="mt-0.5 text-[11px] text-muted-foreground tabular-nums" title={`Estimate: ${p.stock?.toLocaleString()} reported, minus ${est.sold_since.toLocaleString()} ordered since.`}>
                            ≈ {est.estimated.toLocaleString()} estimated
                          </div>
                        ) : null
                      })()}
                    </TD>
                    <TD className="text-right"><NotifyEdit product={p} canEdit={canManage} /></TD>
                    <TD className="hidden text-right md:table-cell">
                      {p.price_minor === null ? '—' : (
                        <>
                          <span className="tabular-nums">{formatMoney(p.price_minor, p.currency)}</span>
                          {p.price_source && <div className="text-[11px] text-muted-foreground">{PRICE_SOURCE_LABEL[p.price_source]}</div>}
                        </>
                      )}
                    </TD>
                    <TD className="hidden text-right tabular-nums lg:table-cell">{p.sold_30d.toLocaleString()}</TD>
                    <TD className="hidden whitespace-nowrap text-muted-foreground xl:table-cell">{p.reported_at ? timeAgo(p.reported_at) : 'Never'}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} total={query.data!.total} onPage={setPage} />
          </>
        )}
      </Card>
      {!query.isLoading && !query.error && (
        <p className="mt-3 text-xs text-muted-foreground">
          Stock numbers come from your shop and are never changed here. "Notify on" is the number at or below which your team is alerted;
          set it per product, or leave it to the shop's own value.
        </p>
      )}
    </>
  )
}
