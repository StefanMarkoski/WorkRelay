import { describe, expect, it } from 'vitest'
import { currenciesByRevenue, eventsByOutcome, ordersByDay, ordersByShop, revenueByDay, runsByOutcome, successRate, totalsFor, type OrdersDaily } from './model'
import { dayKeys } from './series'

const keys = dayKeys('2026-10-05', 5) // Oct 1 .. Oct 5
const row = (day: string, shop: string, currency: string | null, orders: number, cancelled: number, revenue: number): OrdersDaily =>
  ({ day, integration_id: shop, currency, orders, cancelled, revenue_minor: revenue })

const rows = [
  row('2026-10-01', 'A', 'EUR', 2, 0, 3000),
  row('2026-10-02', 'A', 'EUR', 3, 1, 4000), // one cancelled: revenue already excludes it
  row('2026-10-02', 'B', 'USD', 1, 0, 700),
  row('2026-10-04', 'B', 'EUR', 1, 0, 500),
  row('2026-10-04', 'B', null, 1, 0, 0), // an order with no currency
  row('2026-09-20', 'A', 'EUR', 9, 0, 9999), // outside the range
]

describe('currencies', () => {
  it('lists the currencies that have revenue, biggest first, and ignores orders with no currency', () => {
    expect(currenciesByRevenue(rows)).toEqual(['EUR', 'USD'])
    expect(currenciesByRevenue([row('2026-10-01', 'A', null, 1, 0, 0)])).toEqual([])
  })
})

describe('totalsFor', () => {
  it('counts every order, and takes revenue and average order value in one currency only', () => {
    const t = totalsFor(rows, keys, 'EUR')
    expect(t.orders).toBe(8) // 2 + 3 + 1 + 1 + 1, every currency, the old row left out
    expect(t.revenue).toBe(7500)
    expect(t.sold).toBe(2 + 2 + 1) // EUR orders that were not cancelled
    expect(t.aov).toBe(1500)
  })
  it('does not add currencies together', () => {
    expect(totalsFor(rows, keys, 'USD')).toMatchObject({ revenue: 700, sold: 1, aov: 700 })
  })
  it('has no average when nothing was sold, instead of dividing by zero', () => {
    expect(totalsFor(rows, keys, 'JPY').aov).toBeNull()
    expect(totalsFor([], keys, 'EUR')).toEqual({ orders: 0, sold: 0, revenue: 0, aov: null })
  })
  it('works for the previous period by giving it its own days', () => {
    expect(totalsFor(rows, dayKeys('2026-09-20', 1), 'EUR').revenue).toBe(9999)
  })
})

describe('daily series', () => {
  it('zero-fills quiet days and sums shops and currencies on the same day', () => {
    expect(ordersByDay(rows, keys)).toEqual([2, 4, 0, 2, 0])
    expect(revenueByDay(rows, keys, 'EUR')).toEqual([3000, 4000, 0, 500, 0])
    expect(revenueByDay(rows, keys, 'USD')).toEqual([0, 700, 0, 0, 0])
  })
})

describe('ordersByShop', () => {
  it('ranks shops by orders over the range', () => {
    expect(ordersByShop(rows, keys)).toEqual([{ id: 'A', orders: 5 }, { id: 'B', orders: 3 }])
  })
})

describe('automation and delivery outcomes', () => {
  it('groups runs into succeeded, failed and everything else', () => {
    const runs = [
      { day: '2026-10-02', status: 'succeeded', runs: 4 },
      { day: '2026-10-02', status: 'failed', runs: 1 },
      { day: '2026-10-02', status: 'waiting_approval', runs: 2 },
      { day: '2026-10-03', status: 'running', runs: 1 },
    ]
    expect(runsByOutcome(runs, keys)).toEqual({ succeeded: [0, 4, 0, 0, 0], failed: [0, 1, 0, 0, 0], other: [0, 2, 1, 0, 0] })
  })
  it('groups deliveries by what happened to them', () => {
    const ev = [{ day: '2026-10-01', status: 'processed', events: 5 }, { day: '2026-10-01', status: 'failed', events: 1 }, { day: '2026-10-01', status: 'received', events: 1 }]
    expect(eventsByOutcome(ev, keys)).toMatchObject({ processed: [5, 0, 0, 0, 0], failed: [1, 0, 0, 0, 0], waiting: [1, 0, 0, 0, 0], ignored: [0, 0, 0, 0, 0] })
  })
  it('gives a success rate only when something finished', () => {
    expect(successRate(9, 1)).toBe(0.9)
    expect(successRate(0, 0)).toBeNull()
  })
})
