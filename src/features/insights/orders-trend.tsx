import { useMemo, useState } from 'react'
import { BucketChart } from '@/components/charts/bucket-chart'
import { ChartCard } from '@/components/charts/chart-card'
import { formatCompact, formatDelta, formatFull } from '@/components/charts/scale'
import { Select } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { ErrorState } from '@/components/common/states'
import { formatMajor, formatMoney, minorToMajor } from '@/lib/format'
import { currenciesByRevenue, ordersByDay, revenueByDay, totalsFor } from './model'
import { useOrdersDaily } from './queries'
import { formatDay, type RangeDays } from './series'

type Metric = 'orders' | 'revenue'

function Figure({ label, value, delta, period }: { label: string; value: string; delta: string | null; period: RangeDays }) {
  return (
    <div className="min-w-0 px-5 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none font-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{value}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{delta ? `${delta} vs the previous ${period} days` : 'Nothing to compare with yet'}</p>
    </div>
  )
}

/**
 * Orders, or revenue, per day, with the period's totals and how they moved against the period before. Revenue is in one
 * currency at a time (currencies are never added together) and leaves out cancelled orders.
 */
export function OrdersTrendCard({ range, shopId, shopCurrency = null, onRange }: { range: RangeDays; shopId: string; /** The chosen shop's own currency: shown first when the filter is on one shop. */ shopCurrency?: string | null; onRange?: (r: RangeDays) => void }) {
  const q = useOrdersDaily(range, shopId)
  const [metric, setMetric] = useState<Metric>('orders')
  const [picked, setPicked] = useState<string | null>(null)

  const data = q.data
  const currencies = useMemo(() => (data ? currenciesByRevenue(data.rows) : []), [data])
  const preferred = shopId && shopCurrency && currencies.includes(shopCurrency) ? shopCurrency : null
  const currency = picked && currencies.includes(picked) ? picked : preferred ?? currencies[0] ?? null

  if (q.isLoading) return <ChartCard title="Orders and revenue"><div className="h-64 animate-pulse rounded-md bg-secondary/60" /></ChartCard>
  if (q.error || !data) return <ChartCard title="Orders and revenue"><ErrorState onRetry={() => q.refetch()} /></ChartCard>

  const { rows, keys, prevKeys } = data
  const cur = totalsFor(rows, keys, currency)
  const prev = totalsFor(rows, prevKeys, currency)
  const orders = ordersByDay(rows, keys)
  const showRevenue = metric === 'revenue' && currency !== null
  const money = (n: number) => (currency ? formatMajor(n, currency) : formatFull(n))
  const revenueMinor = revenueByDay(rows, keys, currency)
  const values = showRevenue ? revenueMinor.map((v) => minorToMajor(v, currency!)) : orders

  return (
    <ChartCard
      title="Orders and revenue"
      description={`Per day, last ${range} days. Revenue leaves out cancelled orders.`}
      busy={q.isFetching && !q.isLoading}
      controlsBelow
      actions={
        <>
          {onRange && <Segmented label="Time range" value={String(range)} onChange={(v) => onRange(Number(v) as RangeDays)} options={[7, 30, 90].map((r) => ({ id: String(r), label: `${r} days` }))} />}
          {currencies.length > 1 && (
            <Select aria-label="Currency" className="h-8 w-auto text-xs" value={currency ?? ''} onChange={(e) => setPicked(e.target.value)}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
          <Segmented label="Metric" value={metric} onChange={setMetric} options={[{ id: 'orders', label: 'Orders' }, { id: 'revenue', label: 'Revenue' }]} />
        </>
      }
      table={{
        columns: ['Day', 'Orders', currency ? `Revenue (${currency})` : 'Revenue'],
        rows: keys.map((k, i) => [formatDay(k, { weekday: 'short', month: 'short', day: 'numeric' }), orders[i], currency ? money(minorToMajor(revenueMinor[i], currency)) : '—']),
      }}
    >
      <div className="-mx-5 -mt-5 mb-4 grid divide-y border-b sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure label="Orders" value={formatFull(cur.orders)} delta={formatDelta(cur.orders, prev.orders)} period={range} />
        <Figure label={currency ? `Revenue (${currency})` : 'Revenue'} value={currency ? formatMoney(cur.revenue, currency) : '—'} delta={currency ? formatDelta(cur.revenue, prev.revenue) : null} period={range} />
        <Figure label="Average order" value={currency && cur.aov !== null ? formatMoney(cur.aov, currency) : '—'} delta={cur.aov !== null && prev.aov !== null ? formatDelta(cur.aov, prev.aov) : null} period={range} />
      </div>
      <BucketChart
        days={keys}
        kind="columns"
        series={[{ key: metric, label: showRevenue ? `Revenue${currency ? ` (${currency})` : ''}` : 'Orders', color: 'var(--series-1)', values }]}
        formatValue={showRevenue ? money : formatFull}
        formatAxis={showRevenue && currency ? (n) => `${formatCompact(n)}` : formatCompact}
        label={`${showRevenue ? 'Revenue' : 'Orders'} per day, last ${range} days`}
      />
    </ChartCard>
  )
}
