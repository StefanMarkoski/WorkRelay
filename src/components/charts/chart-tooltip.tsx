import type { ReactNode } from 'react'

/**
 * The floating readout over a chart. It sits inside a `relative` wrapper and flips to the other side of the pointer
 * near the right edge. Content is passed as React children, so names from the shops are always rendered as text.
 */
export function ChartTooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const flip = x > width * 0.6
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-36 max-w-64 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
      style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined, top: Math.max(0, y) }}
    >
      {children}
    </div>
  )
}

/** One row of a readout: a short stroke of the series colour, the value first, the name after it. */
export function TooltipRow({ color, label, value, shape = 'line' }: { color: string; label: string; value: string; shape?: 'line' | 'rect' }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span aria-hidden className={shape === 'line' ? 'h-0.5 w-3 shrink-0 translate-y-[-3px] rounded-full' : 'size-2.5 shrink-0 translate-y-[1px] rounded-[2px]'} style={{ background: color }} />
      <span className="font-medium tabular-nums text-foreground">{value}</span>
      <span className="truncate text-muted-foreground">{label}</span>
    </div>
  )
}
