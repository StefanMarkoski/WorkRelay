import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The landing page's signature: one sample event travelling from the shop, through WorkRelay, to the team. It is an order, or a
 * stock update that crosses a product's alert level. Everything here is illustrative sample data, drawn in code so it follows the themes.
 */

type Kind = 'order' | 'stock'

const Key = ({ children }: { children: string }) => <span className="text-white/60">{children}</span>
const Str = ({ children }: { children: string }) => <span className="text-[oklch(0.82_0.1_150)]">{children}</span>

function Stage({ label, delay, rise, children }: { label: string; delay: number; rise: boolean; children: React.ReactNode }) {
  return (
    <li className={cn('relative', rise && 'world-rise')} style={{ '--i': delay } as React.CSSProperties}>
      <span aria-hidden className="absolute top-1 -left-9 grid size-6 place-items-center rounded-full border bg-background">
        <span className="lamp size-2 rounded-full bg-success" />
      </span>
      <p className="mb-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      {children}
    </li>
  )
}

const KINDS: { id: Kind; label: string }[] = [
  { id: 'order', label: 'An order' },
  { id: 'stock', label: 'A stock update' },
]

function Sends({ kind }: { kind: Kind }) {
  return (
    <pre className="housing overflow-x-auto p-4 font-mono text-[12px] leading-relaxed text-white/85">
      {kind === 'order' ? (
        <>
          <span className="text-[oklch(0.82_0.1_150)]">POST</span> /order-webhook{'\n'}
          {'{\n'}
          {'  '}<Key>"event_type"</Key>: <Str>"order.created"</Str>,{'\n'}
          {'  '}<Key>"order"</Key>: {'{\n'}
          {'    '}<Key>"order_number"</Key>: <Str>"#1042"</Str>,{'\n'}
          {'    '}<Key>"customer"</Key>: {'{ '}<Key>"name"</Key>: <Str>"Ana Petrova"</Str>{' },\n'}
          {'    '}<Key>"totals"</Key>: {'{ '}<Key>"total_minor"</Key>: 4999{' },\n'}
          {'    '}<Key>"currency"</Key>: <Str>"EUR"</Str>{'\n'}
          {'  }\n}'}
        </>
      ) : (
        <>
          <span className="text-[oklch(0.82_0.1_150)]">POST</span> /inventory-webhook{'\n'}
          {'{\n'}
          {'  '}<Key>"products"</Key>: {'[{\n'}
          {'    '}<Key>"sku"</Key>: <Str>"PEN-BLU"</Str>,{'\n'}
          {'    '}<Key>"name"</Key>: <Str>"Blue pen"</Str>,{'\n'}
          {'    '}<Key>"stock"</Key>: 1,{'\n'}
          {'    '}<Key>"notify_on"</Key>: 5{'\n'}
          {'  }],\n'}
          {'  '}<Key>"synced_by"</Key>: {'{\n'}
          {'    '}<Key>"name"</Key>: <Str>"Marko"</Str>,{'\n'}
          {'    '}<Key>"role"</Key>: <Str>"Admin"</Str>{'\n'}
          {'  }\n}'}
        </>
      )}
    </pre>
  )
}

function Files({ kind }: { kind: Kind }) {
  return kind === 'order' ? (
    <div className="slip max-w-sm -rotate-[0.6deg] px-5 pt-5 font-mono text-[12px] leading-relaxed shadow-xl">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold tracking-wide">ORDER #1042</span>
        <span className="text-[11px] opacity-60">10:42:07</span>
      </div>
      <div className="opacity-70">Ana Petrova</div>
      <div className="my-2 border-t border-dashed border-current opacity-30" />
      <div className="flex justify-between"><span>Black tee (M) x1</span><span>45.00</span></div>
      <div className="flex justify-between"><span>Shipping</span><span>4.99</span></div>
      <div className="my-2 border-t border-dashed border-current opacity-30" />
      <div className="flex justify-between text-[13px] font-semibold"><span>TOTAL</span><span>49.99 EUR</span></div>
      <div className="mt-2 flex gap-2 text-[11px]">
        <span className="rounded bg-[oklch(0.9_0.08_150)] px-1.5 py-0.5 text-[oklch(0.35_0.1_150)]">paid</span>
        <span className="rounded bg-[oklch(0.92_0.08_80)] px-1.5 py-0.5 text-[oklch(0.4_0.1_70)]">unfulfilled</span>
      </div>
    </div>
  ) : (
    <div className="slip max-w-sm -rotate-[0.6deg] px-5 pt-5 font-mono text-[12px] leading-relaxed shadow-xl">
      <div className="flex items-baseline justify-between">
        <span className="font-semibold tracking-wide">STOCK PEN-BLU</span>
        <span className="text-[11px] opacity-60">10:42:07</span>
      </div>
      <div className="opacity-70">Blue pen, synced by Marko (Admin)</div>
      <div className="my-2 border-t border-dashed border-current opacity-30" />
      <div className="flex justify-between"><span>Before</span><span>120</span></div>
      <div className="flex justify-between"><span>Alert level</span><span>5</span></div>
      <div className="my-2 border-t border-dashed border-current opacity-30" />
      <div className="flex justify-between text-[13px] font-semibold"><span>NOW</span><span>1 left</span></div>
      <div className="mt-2 flex gap-2 text-[11px]">
        <span className="rounded bg-[oklch(0.92_0.08_80)] px-1.5 py-0.5 text-[oklch(0.4_0.1_70)]">low stock</span>
      </div>
    </div>
  )
}

function Hears({ kind }: { kind: Kind }) {
  return (
    <div className="max-w-sm rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-foreground text-xs font-bold text-background">W</span>
        <span className="text-sm font-medium">WorkRelay</span>
        <span className="text-xs text-muted-foreground"># {kind === 'order' ? 'orders' : 'stock'} · 10:42</span>
      </div>
      {kind === 'order' ? (
        <p className="mt-2 text-sm">New order <b className="font-semibold">#1042</b> from Ana Petrova: 49.99 EUR</p>
      ) : (
        <p className="mt-2 text-sm">Low stock: <b className="font-semibold">Blue pen</b> (SKU PEN-BLU) has 1 left, at or below its alert level of 5. Shop: Game Store</p>
      )}
    </div>
  )
}

export function DispatchSlip() {
  const [kind, setKind] = useState<Kind>('order')
  // The first view rises in once, with the page. Switching afterwards is a quick swap, not a second show.
  const [touched, setTouched] = useState(false)

  return (
    <figure aria-label={`A sample ${kind === 'order' ? 'order' : 'stock update'} travelling from a shop to a Discord message`} className="relative max-w-md">
      <div role="group" aria-label="Sample event" className="mb-6 inline-flex gap-1 rounded-lg border p-1">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={kind === k.id}
            onClick={() => {
              setKind(k.id)
              setTouched(true)
            }}
            className={cn(
              'h-8 rounded-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              kind === k.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {k.label}
          </button>
        ))}
      </div>
      <ol key={kind} className={cn('relative space-y-6 pl-9', touched && 'panel-swap')}>
        {/* the relay line, with one dot that travels down it once on load */}
        <span aria-hidden className="absolute top-3 bottom-3 left-3 w-px border-l border-dashed border-muted-foreground/40">
          <span className="landing-travel absolute -left-[3px] size-[7px] rounded-full bg-success shadow-[0_0_10px_2px] shadow-success/50" />
        </span>

        <Stage label="Your shop sends" delay={1} rise={!touched}><Sends kind={kind} /></Stage>
        <Stage label="WorkRelay files it" delay={3} rise={!touched}><Files kind={kind} /></Stage>
        <Stage label="Your team hears about it" delay={5} rise={!touched}><Hears kind={kind} /></Stage>
      </ol>
      <figcaption className="mt-5 pl-9 font-mono text-[11px] text-muted-foreground">Sample {kind === 'order' ? 'order' : 'stock update'}, for illustration.</figcaption>
    </figure>
  )
}
