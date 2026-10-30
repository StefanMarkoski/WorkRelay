import { CheckCircle2, CircleHelp, Clock, Loader, XCircle } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BarList } from '@/components/charts/bar-list'
import { BucketChart } from '@/components/charts/bucket-chart'
import { ChartCard } from '@/components/charts/chart-card'
import { Donut } from '@/components/charts/donut'
import { Heatmap, HeatScale } from '@/components/charts/heatmap'
import { foldSlices, formatFull, percentOf } from '@/components/charts/scale'
import { SegmentedBar } from '@/components/charts/segmented-bar'
import { ErrorState } from '@/components/common/states'
import { useIntegrations } from '@/features/integrations/queries'
import { humanize } from '@/lib/format'
import { eventsByOutcome, ordersByShop, runsByOutcome, successRate } from './model'
import { useCustomersDaily, useEventsDaily, useHourly, useInventoryHealth, useOrderStatus, useOrdersDaily, useRunsDaily, useTopProducts } from './queries'
import { formatDay, sum, type RangeDays } from './series'
import { OTHER_COLOR, shopColor } from './shop-colors'

interface P { range: RangeDays; shopId: string }

const Loading = ({ title, description }: { title: string; description?: string }) => (
  <ChartCard title={title} description={description}><div className="h-52 animate-pulse rounded-md bg-secondary/60" /></ChartCard>
)
const Failed = ({ title, retry }: { title: string; retry: () => void }) => (
  <ChartCard title={title}><ErrorState onRetry={retry} /></ChartCard>
)
const dayRows = (keys: string[], cols: { label: string; values: number[] }[]) =>
  keys.map((k, i) => [formatDay(k, { weekday: 'short', month: 'short', day: 'numeric' }), ...cols.map((c) => c.values[i])])

// State colours. They are the app's own status tokens, always paired with an icon and a label in the legend.
// The healthy bulk of a time series is drawn quietly so the exceptions (failures, things waiting) are what the eye finds:
// "is anything wrong?" is the question these two charts answer, and the instrument's green stays for live state.
const QUIET = 'var(--series-other)'
const QUIET_LIGHT = 'color-mix(in oklab, var(--series-other) 45%, var(--card))'
const ICON = (Icon: typeof Clock, color: string) => <Icon className="size-3.5" style={{ color }} aria-hidden />

// ---------------------------------------------------------------------------------------------------------- orders by shop
export function ShopShareCard({ range, shopId }: P): ReactNode {
  const q = useOrdersDaily(range, shopId)
  const shops = useIntegrations().data ?? []
  if (q.isLoading) return <Loading title="Orders by shop" />
  if (q.error || !q.data) return <Failed title="Orders by shop" retry={() => q.refetch()} />
  const slices = foldSlices(
    ordersByShop(q.data.rows, q.data.keys).map((s) => ({ key: s.id, label: shops.find((x) => x.id === s.id)?.name ?? 'A removed shop', value: s.orders, color: shopColor(s.id, shops) })),
    6,
    (rest) => ({ key: 'other', label: 'Other shops', value: sum(rest.map((r) => r.value)), color: OTHER_COLOR }),
  )
  const total = sum(slices.map((s) => s.value))
  return (
    <ChartCard
      title="Orders by shop"
      description={`Each shop's share of the last ${range} days.`}
      busy={q.isFetching}
      table={{ columns: ['Shop', 'Orders', 'Share'], rows: slices.map((s) => [s.label, s.value, percentOf(s.value, total)]) }}
    >
      <div className="flex h-full min-h-48 items-center"><Donut slices={slices} total="Orders" empty="No orders in this period" /></div>
    </ChartCard>
  )
}

// -------------------------------------------------------------------------------------------------------------- order status
const STATUS: { key: string; color: string; icon: typeof Clock }[] = [
  { key: 'pending', color: 'var(--warning)', icon: Clock },
  { key: 'processing', color: 'var(--info)', icon: Loader },
  { key: 'completed', color: 'var(--success)', icon: CheckCircle2 },
  { key: 'cancelled', color: 'var(--destructive)', icon: XCircle },
  { key: 'unknown', color: 'var(--muted-foreground)', icon: CircleHelp },
]

export function OrderStatusCard({ range, shopId }: P) {
  const q = useOrderStatus(range, shopId)
  if (q.isLoading) return <Loading title="Where orders stand" />
  if (q.error || !q.data) return <Failed title="Where orders stand" retry={() => q.refetch()} />
  const by = new Map(q.data.rows.map((r) => [r.status, r.orders]))
  const parts = STATUS.map((s) => ({ key: s.key, label: humanize(s.key), value: by.get(s.key) ?? 0, color: s.color, ink: 'var(--card)', icon: ICON(s.icon, s.color) }))
  const total = sum(parts.map((p) => p.value))
  return (
    <ChartCard
      title="Where orders stand"
      description={`Status now of the orders placed in the last ${range} days.`}
      busy={q.isFetching}
      table={{ columns: ['Status', 'Orders', 'Share'], rows: parts.map((p) => [p.label, p.value, percentOf(p.value, total)]) }}
    >
      {total === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No orders in this period.</p> : <SegmentedBar parts={parts} label="Orders by status" />}
    </ChartCard>
  )
}

// ------------------------------------------------------------------------------------------------------------ top products
export function TopProductsCard({ range, shopId }: P) {
  const q = useTopProducts(range, shopId)
  const shops = useIntegrations().data ?? []
  const many = shops.filter((s) => s.status === 'connected').length > 1
  if (q.isLoading) return <Loading title="Best sellers" />
  if (q.error || !q.data) return <Failed title="Best sellers" retry={() => q.refetch()} />
  const items = q.data.rows.map((r) => ({
    key: `${r.product_id ?? r.sku}-${r.integration_name}`,
    label: r.name,
    detail: `${r.sku}${many ? ` · ${r.integration_name}` : ''}`,
    value: r.quantity,
    to: r.product_id ? `/inventory/${r.product_id}` : undefined,
  }))
  return (
    <ChartCard
      title="Best sellers"
      description={`Pieces sold in the last ${range} days, cancelled orders left out.`}
      busy={q.isFetching}
      table={{ columns: ['Product', 'SKU', 'Pieces'], rows: items.map((i) => [i.label, i.detail, i.value]) }}
    >
      <BarList items={items} empty="No items sold in this period." />
    </ChartCard>
  )
}

// ------------------------------------------------------------------------------------------------------------ busiest times
export function BusiestTimesCard({ range, shopId }: P) {
  const q = useHourly(range, shopId)
  if (q.isLoading) return <Loading title="When orders arrive" />
  if (q.error || !q.data) return <Failed title="When orders arrive" retry={() => q.refetch()} />
  const cells = q.data.rows.map((r) => ({ dow: r.dow, hour: r.hour, value: r.orders }))
  const max = Math.max(0, ...cells.map((c) => c.value))
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const byDay = days.map((d, i) => [d, sum(cells.filter((c) => c.dow === i).map((c) => c.value))])
  return (
    <ChartCard
      title="When orders arrive"
      description={`By weekday and hour, in your time zone (${q.data.tz}).`}
      busy={q.isFetching}
      table={{ columns: ['Weekday', 'Orders'], rows: byDay.slice(1).concat(byDay.slice(0, 1)) as (string | number)[][] }}
      footer={<HeatScale max={max} />}
    >
      <Heatmap cells={cells} />
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------------------------------------------- customers
export function CustomersCard({ range, shopId }: P) {
  const q = useCustomersDaily(range, shopId)
  if (q.isLoading) return <Loading title="New and returning customers" />
  if (q.error || !q.data) return <Failed title="New and returning customers" retry={() => q.refetch()} />
  const { rows, keys } = q.data
  const fresh = keys.map((k) => sum(rows.filter((r) => r.day === k).map((r) => r.new_customers)))
  const back = keys.map((k) => sum(rows.filter((r) => r.day === k).map((r) => r.returning_orders)))
  const series = [
    { key: 'new', label: 'New customers', color: 'var(--series-1)', values: fresh },
    { key: 'back', label: 'Orders from returning customers', color: 'var(--series-2)', values: back },
  ]
  return (
    <ChartCard
      title="New and returning customers"
      description={`Per day. A customer is new on the day of their first order${shopId ? ' in this shop' : ''}.`}
      busy={q.isFetching}
      legend={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
      table={{ columns: ['Day', 'New customers', 'Returning orders'], rows: dayRows(keys, [{ label: 'n', values: fresh }, { label: 'r', values: back }]) }}
      footer="Customers are matched by email address; orders without one are not counted here."
    >
      <BucketChart days={keys} series={series} kind="stacked" formatValue={formatFull} label={`New customers and returning orders per day, last ${range} days`} />
    </ChartCard>
  )
}

// -------------------------------------------------------------------------------------------------------------- automations
export function AutomationsCard({ range, shopId }: P) {
  const q = useRunsDaily(range, shopId)
  if (q.isLoading) return <Loading title="Automation runs" />
  if (q.error || !q.data) return <Failed title="Automation runs" retry={() => q.refetch()} />
  const { rows, keys } = q.data
  const o = runsByOutcome(rows, keys)
  const rate = successRate(sum(o.succeeded), sum(o.failed))
  const series = [
    { key: 'succeeded', label: 'Succeeded', color: QUIET, values: o.succeeded },
    { key: 'failed', label: 'Failed', color: 'var(--destructive)', values: o.failed },
    { key: 'other', label: 'Waiting or running', color: 'var(--warning)', values: o.other },
  ]
  return (
    <ChartCard
      title="Automation runs"
      description={rate === null ? `Per day, last ${range} days.` : `${Math.round(rate * 100)}% of finished runs succeeded in the last ${range} days.`}
      busy={q.isFetching}
      legend={[
        { key: 'succeeded', label: 'Succeeded', color: QUIET, icon: ICON(CheckCircle2, QUIET) },
        { key: 'failed', label: 'Failed', color: 'var(--destructive)', icon: ICON(XCircle, 'var(--destructive)') },
        { key: 'other', label: 'Waiting or running', color: 'var(--warning)', icon: ICON(Clock, 'var(--warning)') },
      ]}
      table={{ columns: ['Day', 'Succeeded', 'Failed', 'Waiting or running'], rows: dayRows(keys, series) }}
      footer={<Link to="/executions" className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Open Executions</Link>}
    >
      <BucketChart days={keys} series={series} kind="stacked" formatValue={formatFull} label={`Automation runs per day, last ${range} days`} emptyText="No automation runs in this period" />
    </ChartCard>
  )
}

// ---------------------------------------------------------------------------------------------------------------- deliveries
export function DeliveriesCard({ range, shopId }: P) {
  const q = useEventsDaily(range, shopId)
  if (q.isLoading) return <Loading title="Deliveries from your shops" />
  if (q.error || !q.data) return <Failed title="Deliveries from your shops" retry={() => q.refetch()} />
  const { rows, keys } = q.data
  const o = eventsByOutcome(rows, keys)
  const rate = successRate(sum(o.processed), sum(o.failed))
  const series = [
    { key: 'processed', label: 'Processed', color: QUIET, values: o.processed },
    { key: 'ignored', label: 'Ignored', color: QUIET_LIGHT, values: o.ignored },
    { key: 'waiting', label: 'Waiting', color: 'var(--warning)', values: o.waiting },
    { key: 'failed', label: 'Failed', color: 'var(--destructive)', values: o.failed },
  ]
  return (
    <ChartCard
      title="Deliveries from your shops"
      description={rate === null ? 'Orders, signups and product feeds your shops sent.' : `${Math.round(rate * 100)}% of the orders, signups and product feeds your shops sent were processed.`}
      busy={q.isFetching}
      legend={[
        { key: 'processed', label: 'Processed', color: QUIET, icon: ICON(CheckCircle2, QUIET) },
        { key: 'ignored', label: 'Ignored', color: QUIET_LIGHT, icon: ICON(CircleHelp, QUIET_LIGHT) },
        { key: 'waiting', label: 'Waiting', color: 'var(--warning)', icon: ICON(Clock, 'var(--warning)') },
        { key: 'failed', label: 'Failed', color: 'var(--destructive)', icon: ICON(XCircle, 'var(--destructive)') },
      ]}
      table={{ columns: ['Day', 'Processed', 'Ignored', 'Waiting', 'Failed'], rows: dayRows(keys, series) }}
      footer={<Link to="/integrations" className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Open Event history</Link>}
    >
      <BucketChart days={keys} series={series} kind="stacked" formatValue={formatFull} label={`Deliveries per day, last ${range} days`} emptyText="No deliveries in this period" />
    </ChartCard>
  )
}

// ------------------------------------------------------------------------------------------------------- inventory health
export function InventoryHealthCard({ shopId, bare = false }: { shopId: string; bare?: boolean }) {
  const q = useInventoryHealth(shopId)
  const parts = useMemo(() => {
    const h = q.data
    return [
      { key: 'low', label: 'Low', value: h?.low ?? 0, color: 'var(--warning)', ink: 'var(--card)', icon: ICON(Clock, 'var(--warning)') },
      { key: 'ok', label: 'Fine', value: h?.ok ?? 0, color: 'var(--success)', ink: 'var(--card)', icon: ICON(CheckCircle2, 'var(--success)') },
      { key: 'none', label: 'No alert level', value: h?.no_threshold ?? 0, color: 'var(--series-other)', ink: 'var(--card)', icon: ICON(CircleHelp, 'var(--series-other)') },
      { key: 'unreported', label: 'Stock not reported', value: h?.not_reported ?? 0, color: QUIET_LIGHT, ink: 'var(--foreground)', icon: ICON(CircleHelp, QUIET_LIGHT) },
    ]
  }, [q.data])
  const total = sum(parts.map((p) => p.value))
  const body = q.isLoading ? (
    <div className="h-16 animate-pulse rounded-md bg-secondary/60" />
  ) : q.error ? (
    <ErrorState onRetry={() => q.refetch()} />
  ) : total === 0 ? (
    <p className="py-4 text-sm text-muted-foreground">No products yet. They appear when a shop reports them, or when an order contains an item with a SKU.</p>
  ) : (
    <SegmentedBar parts={parts} label="Products by stock level" />
  )
  if (bare) return <>{body}</>
  return (
    <ChartCard
      title="Stock levels"
      description="How the catalogue stands right now. Low means at or below its Notify on number."
      busy={q.isFetching && !q.isLoading}
      table={{ columns: ['Stock level', 'Products', 'Share'], rows: parts.map((p) => [p.label, p.value, percentOf(p.value, total)]) }}
      footer={<Link to="/inventory" className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Open Inventory</Link>}
    >
      {body}
    </ChartCard>
  )
}

