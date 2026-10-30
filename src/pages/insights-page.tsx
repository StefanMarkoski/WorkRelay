import { useState, type ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { PageHeader } from '@/components/common/page-header'
import { AutomationsCard, BusiestTimesCard, CustomersCard, DeliveriesCard, InventoryHealthCard, OrderStatusCard, ShopShareCard, TopProductsCard } from '@/features/insights/cards'
import { RangeSegmented, ShopSelect } from '@/features/insights/filters'
import { OrdersTrendCard } from '@/features/insights/orders-trend'
import { browserTz, type RangeDays } from '@/features/insights/series'
import { useIntegrations } from '@/features/integrations/queries'

/**
 * How the shops are doing over time. One filter row sets the period and the shop for everything below it, so every
 * number on the page agrees. Each card loads on its own and has a table view with the same numbers.
 */
export function InsightsPage() {
  const shops = useIntegrations().data ?? []
  const [range, setRange] = useState<RangeDays>(30)
  const [shopId, setShopId] = useState('') // '' = all shops together
  const connected = shops.filter((s) => s.status === 'connected')

  const share = connected.length > 1 && !shopId
  const stack = (...cards: ReactNode[]) => <div className="flex flex-col gap-6 [&>*]:flex-auto">{cards}</div>

  return (
    <>
      <PageHeader title="Insights" description={`Trends across your shops. Days follow your time zone (${browserTz()}).`} />
      <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
        <RangeSegmented value={range} onChange={setRange} />
        <ShopSelect shops={shops} value={shopId} onChange={setShopId} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="grid lg:col-span-2"><OrdersTrendCard range={range} shopId={shopId} shopCurrency={shops.find((s) => s.id === shopId)?.currency ?? null} /></div>
        {/* A tall donut beside two short bars; with one shop the two bars sit side by side instead */}
        {share ? (
          <>
            <ShopShareCard range={range} shopId={shopId} />
            {stack(<OrderStatusCard key="status" range={range} shopId={shopId} />, <InventoryHealthCard key="stock" shopId={shopId} />)}
          </>
        ) : (
          <>
            <OrderStatusCard range={range} shopId={shopId} />
            <InventoryHealthCard shopId={shopId} />
          </>
        )}
        <TopProductsCard range={range} shopId={shopId} />
        <CustomersCard range={range} shopId={shopId} />
        <AutomationsCard range={range} shopId={shopId} />
        <DeliveriesCard range={range} shopId={shopId} />
        <div className="grid lg:col-span-2"><BusiestTimesCard range={range} shopId={shopId} /></div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Revenue is shown in one currency at a time and leaves out cancelled orders. Everything here is counted from what your shops have sent to WorkRelay.
      </p>
    </>
  )
}
