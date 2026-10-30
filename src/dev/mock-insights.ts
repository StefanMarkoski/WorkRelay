/**
 * Dev-only: invented daily figures for the Insights screens (the mock build never ships), generated with a seeded
 * generator so the same days always look the same. It mirrors what the functions in migration 0017 return, including
 * the shop filter, so every chart can be seen and clicked through without a login.
 */
type Row = Record<string, any>

const SHOPS = [
  { id: '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a01', currency: 'MKD', base: 11, price: 280000 },
  { id: '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a02', currency: 'USD', base: 6, price: 5400 },
]

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}
const keyOf = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000)

function daysSince(since: string): { key: string; dow: number; n: number }[] {
  const start = new Date(since)
  const end = new Date()
  const out: { key: string; dow: number; n: number }[] = []
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1)), n = 0; d <= end; d = addDays(d, 1), n++) {
    out.push({ key: keyOf(d), dow: d.getUTCDay(), n })
  }
  return out
}

const WEEK = [0.8, 0.9, 1, 1.05, 1.15, 1.4, 1.25] // Sun..Sat: a shop that sells more towards the weekend

export function insightsRpc(name: string, args: Record<string, any>, empty: boolean): Row[] {
  const since: string = args.p_since ?? new Date(Date.now() - 30 * 86_400_000).toISOString()
  const only: string | null = args.p_integration ?? null
  const shops = SHOPS.filter((s) => !only || s.id === only)
  if (empty) return name === 'insights_inventory_health' ? [{ low: 0, ok: 0, no_threshold: 0, not_reported: 0 }] : []

  const orders = (day: { key: string; dow: number; n: number }, s: (typeof SHOPS)[number], r: () => number) => {
    const trend = 1 + day.n / 220 // a slowly growing shop
    const count = Math.max(0, Math.round(s.base * WEEK[day.dow] * trend + (r() - 0.5) * 5))
    const cancelled = Math.round(count * (0.04 + r() * 0.08))
    return { count, cancelled, revenue: Math.round((count - cancelled) * s.price * (0.85 + r() * 0.3)) }
  }

  switch (name) {
    case 'insights_orders_daily':
      return daysSince(since).flatMap((d) => shops.map((s) => {
        const r = rng(d.n * 31 + s.currency.charCodeAt(0))
        const o = orders(d, s, r)
        return o.count === 0 ? null : { day: d.key, integration_id: s.id, currency: s.currency, orders: o.count, cancelled: o.cancelled, revenue_minor: o.revenue }
      }).filter(Boolean)) as Row[]
    case 'insights_runs_daily':
      return daysSince(since).flatMap((d) => {
        const r = rng(d.n * 17 + 5)
        const ok = Math.round(shops.reduce((n, s) => n + s.base, 0) * WEEK[d.dow] * (0.8 + r() * 0.4))
        return [
          { day: d.key, status: 'succeeded', runs: ok },
          ...(r() < 0.35 ? [{ day: d.key, status: 'failed', runs: 1 + Math.round(r() * 2) }] : []),
          ...(r() < 0.3 ? [{ day: d.key, status: 'waiting_approval', runs: 1 + Math.round(r() * 2) }] : []),
        ]
      })
    case 'insights_events_daily':
      return daysSince(since).flatMap((d) => {
        const r = rng(d.n * 13 + 9)
        const total = Math.round(shops.reduce((n, s) => n + s.base, 0) * WEEK[d.dow] * 1.6)
        return [
          { day: d.key, status: 'processed', events: total },
          ...(r() < 0.25 ? [{ day: d.key, status: 'failed', events: 1 + Math.round(r() * 3) }] : []),
          ...(r() < 0.2 ? [{ day: d.key, status: 'ignored', events: 1 + Math.round(r() * 2) }] : []),
        ]
      })
    case 'insights_customers_daily':
      return daysSince(since).map((d) => {
        const r = rng(d.n * 7 + 3)
        const total = shops.reduce((n, s) => n + Math.round(s.base * WEEK[d.dow] * (0.8 + r() * 0.4)), 0)
        const fresh = Math.round(total * (0.55 - Math.min(0.3, d.n / 400)))
        return { day: d.key, new_customers: fresh, returning_orders: Math.max(0, total - fresh) }
      })
    case 'insights_order_status':
      return [
        { status: 'completed', orders: 212 }, { status: 'processing', orders: 38 }, { status: 'pending', orders: 21 },
        { status: 'cancelled', orders: 17 }, { status: 'unknown', orders: 2 },
      ].map((x) => (only ? { ...x, orders: Math.round(x.orders * 0.55) } : x))
    case 'insights_top_products':
      return [
        ['Road bike 700c', 'BIKE-ROAD-700', 'Game Store', 84], ['Mouse pad XL', 'PAD-XL', 'Game Store', 61], ['Gift card 50', 'GC-50', 'Game Store 2', 47],
        ['Steam key 10', 'KEY-STEAM-10', 'Game Store 2', 33], ['Steel nails (box of 100)', 'NAIL-100', 'Game Store', 18], ['Wireless headset', 'HS-W1', 'Game Store 2', 9],
      ].map(([name, sku, shop, quantity], i) => ({ product_id: i < 5 ? `pr${i + 1}` : null, sku, name, integration_name: shop, quantity }))
    case 'insights_hourly':
      return Array.from({ length: 7 }, (_, dow) => Array.from({ length: 24 }, (_, hour) => {
        const day = Math.exp(-((hour - 14) ** 2) / 30) * 0.7 + Math.exp(-((hour - 20) ** 2) / 10) * 0.9 // lunchtime and evening
        const v = Math.round(day * WEEK[dow] * 9 * (only ? 0.6 : 1))
        return v > 0 ? { dow, hour, orders: v } : null
      })).flat().filter(Boolean) as Row[]
    case 'insights_inventory_health':
      return [{ low: 2, ok: 9, no_threshold: 4, not_reported: 3 }]
    default:
      return []
  }
}
