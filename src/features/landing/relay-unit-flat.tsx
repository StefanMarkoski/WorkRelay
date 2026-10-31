import { UNIT_CHANNELS, UNIT_COLS } from './demo-feed'

/**
 * The same shop-to-unit scene drawn in plain DOM. It is what loads first, what reduced-motion and no-WebGL visitors keep,
 * and it matches the 3D scene's story: a shop, one webhook per order, and the relay unit's channels.
 */
export function RelayUnitFlat({ lit }: { lit: ReadonlySet<number> }) {
  return (
    <div className="aspect-[16/9] w-full">
      <div className="flex h-[24%] items-center gap-3 font-mono text-[11px] tracking-wide text-muted-foreground sm:text-xs">
        <span className="grid h-[70%] min-w-[22%] place-items-center rounded-md bg-[var(--housing)] px-3 text-[oklch(0.7_0.012_150)]">YOUR SHOP</span>
        <span aria-hidden className="relative h-px flex-1 bg-border">
          <span className="absolute top-1/2 left-[45%] h-2 w-4 -translate-y-1/2 rounded-sm bg-primary" />
        </span>
        <span className="shrink-0">ONE WEBHOOK PER EVENT</span>
      </div>
      <div className="housing h-[76%] p-[4%]">
        <div className="flex items-baseline justify-between font-mono text-[11px] tracking-wide text-[oklch(0.58_0.012_150)] sm:text-xs">
          <span>RELAY UNIT 01</span>
          <span>SAMPLE FEED</span>
        </div>
        <div className="mt-[3%] grid gap-[2%]" style={{ gridTemplateColumns: `repeat(${UNIT_COLS}, minmax(0, 1fr))` }}>
          {Array.from({ length: UNIT_CHANNELS }, (_, i) => (
            <div key={i} className="grid aspect-[1.35] place-items-center rounded-[18%] bg-[oklch(0.15_0.006_150)]">
              <span className="lamp size-[22%] rounded-full" data-on={lit.has(i)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
