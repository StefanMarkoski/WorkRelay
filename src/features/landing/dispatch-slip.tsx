/**
 * The landing page's signature: one sample order travelling from the shop, through WorkRelay, to the team.
 * Everything here is illustrative sample data, drawn in code so it follows the app's themes.
 */

const Key = ({ children }: { children: string }) => <span className="text-[oklch(0.72_0.06_270)]">{children}</span>
const Str = ({ children }: { children: string }) => <span className="text-[oklch(0.82_0.12_295)]">{children}</span>

function Stage({ label, delay, children }: { label: string; delay: string; children: React.ReactNode }) {
  return (
    <li className="landing-rise relative" style={{ animationDelay: delay }}>
      <span aria-hidden className="absolute top-1 -left-9 grid size-6 place-items-center rounded-full border bg-background">
        <span className="size-2 rounded-full bg-primary" />
      </span>
      <p className="mb-2 font-mono text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      {children}
    </li>
  )
}

export function DispatchSlip() {
  return (
    <figure aria-label="A sample order travelling from a shop to a Discord message" className="relative">
      <ol className="relative space-y-6 pl-9">
        {/* the relay line, with one dot that travels down it once on load */}
        <span aria-hidden className="absolute top-3 bottom-3 left-3 w-px border-l border-dashed border-primary/40">
          <span className="landing-travel absolute -left-[3px] size-[7px] rounded-full bg-primary shadow-[0_0_12px_2px] shadow-primary/60" />
        </span>

        <Stage label="Your shop sends" delay="0.1s">
          <pre className="overflow-x-auto rounded-lg border border-white/10 bg-[oklch(0.17_0.015_275)] p-4 font-mono text-[12px] leading-relaxed text-[oklch(0.86_0.01_275)]">
            <span className="text-[oklch(0.7_0.1_160)]">POST</span> /order-webhook{'\n'}
            {'{\n'}
            {'  '}<Key>"event_type"</Key>: <Str>"order.created"</Str>,{'\n'}
            {'  '}<Key>"order"</Key>: {'{\n'}
            {'    '}<Key>"order_number"</Key>: <Str>"#1042"</Str>,{'\n'}
            {'    '}<Key>"customer"</Key>: {'{ '}<Key>"name"</Key>: <Str>"Ana Petrova"</Str>{' },\n'}
            {'    '}<Key>"totals"</Key>: {'{ '}<Key>"total_minor"</Key>: 4999{' },\n'}
            {'    '}<Key>"currency"</Key>: <Str>"EUR"</Str>{'\n'}
            {'  }\n}'}
          </pre>
        </Stage>

        <Stage label="WorkRelay files it" delay="0.35s">
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
        </Stage>

        <Stage label="Your team hears about it" delay="0.6s">
          <div className="max-w-sm rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">W</span>
              <span className="text-sm font-medium">WorkRelay</span>
              <span className="text-xs text-muted-foreground"># orders · 10:42</span>
            </div>
            <p className="mt-2 text-sm">New order <b>#1042</b> from Ana Petrova: 49.99 EUR</p>
          </div>
        </Stage>
      </ol>
      <figcaption className="mt-5 pl-9 font-mono text-[11px] text-muted-foreground">Sample order, for illustration.</figcaption>
    </figure>
  )
}
