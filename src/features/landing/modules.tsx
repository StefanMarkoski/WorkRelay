import { useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * "What you get": four parts of the shop on one instrument. A list on the left picks the part, and the housing on the right
 * shows a small sample of it. Everything in the housing is invented sample data, drawn in code so it follows the themes.
 */

type ModuleId = 'orders' | 'stock' | 'customers' | 'insights'

const MODULES: { id: ModuleId; name: string; line: string }[] = [
  { id: 'orders', name: 'Orders', line: 'Every order from every shop, with its full timeline and who changed what.' },
  { id: 'stock', name: 'Stock', line: 'What is on the shelf, what is running low, and a message before it runs out.' },
  { id: 'customers', name: 'Customers', line: 'One profile per person across your shops: what they ordered and what they are worth.' },
  { id: 'insights', name: 'Insights', line: 'Trends in orders, revenue, best sellers and busy hours, counted from your own data.' },
]

function Legend({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-baseline justify-between font-mono text-[11px] tracking-wide text-muted-foreground sm:text-xs">
      <span>{left}</span>
      <span>{right}</span>
    </div>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <li className="tnum grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 py-2.5 text-sm sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">{children}</li>
}

const ORDERS = [
  { n: '#1045', who: 'Elena Todorova', total: '82.00 EUR', state: 'Processing' },
  { n: '#1044', who: 'Marko Ilievski', total: '19.90 EUR', state: 'Completed' },
  { n: '#1043', who: 'Ana Petrova', total: '1,240.00 EUR', state: 'Held for approval' },
  { n: '#1042', who: 'Ana Petrova', total: '49.99 EUR', state: 'Completed' },
]

function OrdersPanel() {
  return (
    <>
      <Legend left="ORDERS" right="SAMPLE DATA" />
      <ul className="mt-4 divide-y divide-[var(--border)]">
        {ORDERS.map((o) => (
          <Row key={o.n}>
            <span className="font-mono text-foreground">{o.n}</span>
            <span className="col-start-1 row-start-2 truncate text-muted-foreground sm:col-start-2 sm:row-start-1">{o.who}</span>
            <span className="row-span-2 text-right sm:row-span-1">
              <span className="block text-foreground">{o.total}</span>
              <span className={cn('block text-xs sm:inline sm:pl-3', o.state === 'Held for approval' ? 'text-warning' : 'text-muted-foreground')}>{o.state}</span>
            </span>
          </Row>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">Orders above an amount you choose wait for a person to review them.</p>
    </>
  )
}

const STOCK = [
  { sku: 'TEE-BLK-M', name: 'Black tee, M', left: 24, alert: 5 },
  { sku: 'HOOD-GRY', name: 'Grey hoodie', left: 9, alert: 5 },
  { sku: 'BTL-STL', name: 'Steel bottle', left: 14, alert: 5 },
  { sku: 'PEN-BLU', name: 'Blue pen', left: 1, alert: 5 },
  { sku: 'NOTE-A5', name: 'A5 notebook', left: 5, alert: 5 },
]

function StockPanel() {
  return (
    <>
      <Legend left="STOCK" right="SAMPLE DATA" />
      <ul className="mt-4 divide-y divide-[var(--border)]">
        {STOCK.map((p) => {
          const low = p.left <= p.alert
          return (
            <Row key={p.sku}>
              <span className="font-mono text-foreground">{p.sku}</span>
              <span className="col-start-1 row-start-2 truncate text-muted-foreground sm:col-start-2 sm:row-start-1">{p.name}</span>
              <span className="row-span-2 flex items-center justify-end gap-2.5 sm:row-span-1">
                <span aria-hidden className={cn('size-2 rounded-full', low ? 'bg-warning' : 'bg-[var(--border)]')} />
                <span className={low ? 'text-foreground' : 'text-muted-foreground'}>
                  {p.left} left
                  <span className="sr-only">{low ? ', low' : ''}</span>
                </span>
              </span>
            </Row>
          )
        })}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">Alert at 5. When a product drops to it, your team is told once, then again only after it has been restocked.</p>
    </>
  )
}

const CUSTOMERS = [
  { who: 'Ana Petrova', facts: '3 orders', spent: '1,332.89 EUR' },
  { who: 'Marko Ilievski', facts: '1 order', spent: '19.90 EUR' },
  { who: 'Elena Todorova', facts: '1 order', spent: '82.00 EUR' },
  { who: 'Nikola Stojanov', facts: 'Signed up, no order yet', spent: '' },
]

function CustomersPanel() {
  return (
    <>
      <Legend left="CUSTOMERS" right="SAMPLE DATA" />
      <ul className="mt-4 divide-y divide-[var(--border)]">
        {CUSTOMERS.map((c) => (
          <li key={c.who} className="tnum flex min-h-12 items-center justify-between gap-4 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="block truncate text-foreground">{c.who}</span>
              <span className="block truncate text-xs text-muted-foreground">{c.facts}</span>
            </span>
            <span className="shrink-0 text-foreground">{c.spent}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">The same email at two shops is one customer.</p>
    </>
  )
}

const DAYS = [6, 9, 7, 12, 10, 8, 14, 11, 9, 15, 13, 10, 17, 14]

function InsightsPanel() {
  const max = Math.max(...DAYS)
  const w = 560
  const h = 150
  const gap = 8
  const bar = (w - gap * (DAYS.length - 1)) / DAYS.length
  const busiest = DAYS.indexOf(max)
  return (
    <>
      <Legend left="ORDERS PER DAY, LAST 14 DAYS" right="SAMPLE DATA" />
      <svg viewBox={`0 0 ${w} ${h + 22}`} role="img" aria-label={`Sample bar chart of orders per day over 14 days. The busiest day had ${max} orders.`} className="mt-5 block h-auto w-full text-muted-foreground">
        {DAYS.map((v, i) => {
          const bh = (v / max) * h
          return <rect key={i} x={i * (bar + gap)} y={h - bh} width={bar} height={bh} rx={2} fill="currentColor" opacity={i === busiest ? 1 : 0.45} className={i === busiest ? 'text-foreground' : undefined} />
        })}
        <text x={busiest * (bar + gap) + bar / 2} y={h + 16} textAnchor="middle" fontSize={12} fill="currentColor" className="font-mono text-foreground">{max}</text>
      </svg>
      <p className="mt-4 text-xs text-muted-foreground">Also: revenue by shop, best sellers, new and returning customers, and the hours your orders arrive.</p>
    </>
  )
}

const PANELS: Record<ModuleId, () => React.JSX.Element> = { orders: OrdersPanel, stock: StockPanel, customers: CustomersPanel, insights: InsightsPanel }

export function Modules() {
  const [active, setActive] = useState<ModuleId>('orders')
  const base = useId()
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const Panel = PANELS[active]

  // Arrow keys move between the tabs, the way a tab list is expected to work.
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? MODULES.length - 1 : (index + step + MODULES.length) % MODULES.length
    setActive(MODULES[next].id)
    refs.current[MODULES[next].id]?.focus()
  }

  return (
    <section id="what-you-get" aria-labelledby="modules-title" className="mx-auto grid max-w-[1200px] scroll-mt-16 items-start gap-12 px-6 py-20 sm:py-28 lg:grid-cols-12 lg:gap-8">
      <div className="lg:col-span-5">
        <h2 id="modules-title" className="font-display text-balance text-3xl leading-[1.05] font-semibold tracking-[-0.025em] sm:text-4xl lg:text-[2.75rem]">
          One calm place for the whole shop.
        </h2>
        <p className="mt-5 max-w-[44ch] text-muted-foreground">Orders, stock, customers and the trends behind them, kept together and kept current, for every shop you connect.</p>
        <div role="tablist" aria-label="Parts of the shop" aria-orientation="vertical" className="mt-10 divide-y border-y">
          {MODULES.map((m, i) => {
            const on = m.id === active
            return (
              <button
                key={m.id}
                ref={(el) => {
                  refs.current[m.id] = el
                }}
                id={`${base}-tab-${m.id}`}
                role="tab"
                type="button"
                aria-selected={on}
                aria-controls={`${base}-panel`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActive(m.id)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className="group flex w-full gap-4 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span aria-hidden className={cn('lamp mt-[0.55em] size-2 shrink-0 rounded-full', !on && 'group-hover:bg-muted-foreground/60')} data-on={on} />
                <span>
                  <span className={cn('block font-display text-lg font-medium tracking-tight transition-colors', on ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')}>{m.name}</span>
                  <span className="mt-1 block max-w-[46ch] text-sm text-muted-foreground">{m.line}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="lg:col-span-7">
        <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${active}`} className="housing min-h-[22rem] p-5 sm:p-7">
          <div key={active} className="panel-swap">
            <Panel />
          </div>
        </div>
      </div>
    </section>
  )
}
