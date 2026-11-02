import { ArrowLeft } from 'lucide-react'
import { Link, NavLink, Navigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { Card } from '@/components/ui/card'
import { useIntegrations } from '@/features/integrations/queries'
import { ActivityTab } from '@/features/shops/activity-tab'
import { CustomersTab } from '@/features/shops/customers-tab'
import { ExportTab } from '@/features/shops/export-tab'
import { GeneralTab } from '@/features/shops/general-tab'
import { InventoryTab } from '@/features/shops/inventory-tab'
import { OrdersTab } from '@/features/shops/orders-tab'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { cn } from '@/lib/utils'
import { Plug } from 'lucide-react'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'orders', label: 'Orders' },
  { id: 'customers', label: 'Customers' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'export', label: 'Export' },
  { id: 'activity', label: 'Activity' },
] as const
type TabId = (typeof TABS)[number]['id']

/**
 * One shop, everything about it: /shops/<id>/edit/<tab>. General (name, currency, key), then one tab for each kind of data the shop
 * exchanges with WorkRelay (orders, customers, inventory), what it may read back (export), and what it has sent (activity).
 * Each tab is a real route, so a link to one opens straight on it and the browser's back button works.
 */
export function ShopPage() {
  const { id = '', tab } = useParams()
  const { canManage } = useWorkspace()
  const shops = useIntegrations({ poll: true })
  const shop = shops.data?.find((s) => s.id === id)

  if (shops.isLoading) return <TableSkeleton rows={4} />
  if (shops.error) return <ErrorState onRetry={() => shops.refetch()} />
  if (!shop) return <Card><EmptyState icon={Plug} title="This shop is not here" description="It may have been removed, or it belongs to another workspace." action={<Link to="/shops" className="text-sm underline underline-offset-4">Back to shops</Link>} /></Card>
  if (!tab) return <Navigate to={`/shops/${id}/edit/general`} replace />
  const active = TABS.find((t) => t.id === tab)?.id as TabId | undefined
  if (!active) return <Navigate to={`/shops/${id}/edit/general`} replace />

  return (
    <>
      <Link to="/shops" className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Shops
      </Link>
      <PageHeader
        title={shop.name}
        description={shop.currency ? `Sells in ${shop.currency}. Set up everything this shop sends to WorkRelay, and what it may read back.` : 'Set up everything this shop sends to WorkRelay, and what it may read back.'}
        actions={<StatusBadge status={shop.status} />}
      />
      <nav aria-label={`${shop.name} sections`} className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden border-b">
        {TABS.map((t) => (
          <NavLink
            key={t.id}
            to={`/shops/${id}/edit/${t.id}`}
            className={({ isActive }) =>
              cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      {!canManage && active !== 'activity' && (
        <p role="status" className="mb-4 text-xs text-muted-foreground">Only owners and admins can change a shop&apos;s settings.</p>
      )}
      {shop.status === 'revoked' && <p role="status" className="mb-4 text-sm text-destructive">This connection was revoked and no longer accepts anything.</p>}
      {active === 'general' && <GeneralTab key={shop.id} shop={shop} />}
      {active === 'orders' && <OrdersTab />}
      {active === 'customers' && <CustomersTab shop={shop} />}
      {active === 'inventory' && <InventoryTab shop={shop} />}
      {active === 'export' && <ExportTab shop={shop} />}
      {active === 'activity' && <ActivityTab shopId={shop.id} />}
    </>
  )
}
