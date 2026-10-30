import { fillSeries, sum } from './series'

/** Rows as the Insights functions return them (migration 0017). Counts arrive as plain numbers. */
export interface OrdersDaily { day: string; integration_id: string; currency: string | null; orders: number; cancelled: number; revenue_minor: number }
export interface RunsDaily { day: string; status: string; runs: number }
export interface EventsDaily { day: string; status: string; events: number }
export interface CustomersDaily { day: string; new_customers: number; returning_orders: number }
export interface StatusRow { status: string; orders: number }
export interface TopProduct { product_id: string | null; sku: string; name: string; integration_name: string; quantity: number }
export interface HourlyRow { dow: number; hour: number; orders: number }
export interface Health { low: number; ok: number; no_threshold: number; not_reported: number }

const within = <T extends { day: string }>(rows: T[], keys: string[]) => {
  const set = new Set(keys)
  return rows.filter((r) => set.has(r.day))
}

/** Currencies that have revenue in the rows, the biggest first: the default one to show, and the choices when there are several. */
export function currenciesByRevenue(rows: OrdersDaily[]): string[] {
  const by = new Map<string, number>()
  for (const r of rows) if (r.currency) by.set(r.currency, (by.get(r.currency) ?? 0) + r.revenue_minor)
  return [...by.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c]) => c)
}

export interface Totals {
  orders: number
  /** Orders that were not cancelled, in the chosen currency (what an average order is taken over). */
  sold: number
  revenue: number
  /** Average order value in the chosen currency's minor unit; null when nothing was sold. */
  aov: number | null
}

/** Totals for one stretch of days, with revenue and average order value in a single currency (currencies are never added). */
export function totalsFor(rows: OrdersDaily[], keys: string[], currency: string | null): Totals {
  const r = within(rows, keys)
  const inCurrency = r.filter((x) => x.currency === currency)
  const sold = sum(inCurrency.map((x) => x.orders - x.cancelled))
  const revenue = sum(inCurrency.map((x) => x.revenue_minor))
  return { orders: sum(r.map((x) => x.orders)), sold, revenue, aov: sold > 0 ? Math.round(revenue / sold) : null }
}

/** Orders per day (every currency, cancelled included: it is a count of orders placed). */
export const ordersByDay = (rows: OrdersDaily[], keys: string[]) => fillSeries(rows, keys, (r) => r.orders)

/** Revenue per day in one currency, in minor units. */
export const revenueByDay = (rows: OrdersDaily[], keys: string[], currency: string | null) =>
  fillSeries(rows.filter((r) => r.currency === currency), keys, (r) => r.revenue_minor)

/** Orders per shop over the days given, biggest first. */
export function ordersByShop(rows: OrdersDaily[], keys: string[]): { id: string; orders: number }[] {
  const by = new Map<string, number>()
  for (const r of within(rows, keys)) by.set(r.integration_id, (by.get(r.integration_id) ?? 0) + r.orders)
  return [...by.entries()].map(([id, orders]) => ({ id, orders })).sort((a, b) => b.orders - a.orders)
}

/** Runs per day, split into the three outcomes a person cares about; everything not yet finished is "in progress". */
export function runsByOutcome(rows: RunsDaily[], keys: string[]) {
  const pick = (f: (s: string) => boolean) => fillSeries(rows, keys, (r) => (f(r.status) ? r.runs : 0))
  return {
    succeeded: pick((s) => s === 'succeeded'),
    failed: pick((s) => s === 'failed'),
    other: pick((s) => s !== 'succeeded' && s !== 'failed'),
  }
}

/** Deliveries per day by what happened to them. */
export function eventsByOutcome(rows: EventsDaily[], keys: string[]) {
  const pick = (f: (s: string) => boolean) => fillSeries(rows, keys, (r) => (f(r.status) ? r.events : 0))
  return {
    processed: pick((s) => s === 'processed'),
    ignored: pick((s) => s === 'ignored'),
    failed: pick((s) => s === 'failed'),
    waiting: pick((s) => s === 'received'),
  }
}

/** How many failed out of how many that finished, for the line under a reliability chart. Null with nothing to measure. */
export function successRate(ok: number, bad: number): number | null {
  return ok + bad > 0 ? ok / (ok + bad) : null
}
