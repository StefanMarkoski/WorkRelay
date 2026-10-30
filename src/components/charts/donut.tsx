import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatFull, percentOf } from './scale'

export interface DonutSlice {
  key: string
  label: string
  value: number
  color: string
}

const R = 80 // outer radius
const THICK = 22
const GAP_PX = 2 // the surface-coloured gap between slices

function arc(cx: number, cy: number, a0: number, a1: number): string {
  const ro = R
  const ri = R - THICK
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${p(ro, a0)} A${ro},${ro} 0 ${large} 1 ${p(ro, a1)} L${p(ri, a1)} A${ri},${ri} 0 ${large} 0 ${p(ri, a0)} Z`
}

/**
 * One whole split into a few parts, for reading the share at a glance (six at most; the caller folds the tail into
 * "Other"). The centre shows the total, or the slice you point at. The list beside it carries every name, amount and
 * share, so nothing depends on colour or on hovering. To compare close values, use ranked bars instead.
 */
export function Donut({
  slices,
  total: totalLabel,
  unit,
  formatValue = formatFull,
  empty = 'Nothing to show yet',
}: {
  slices: DonutSlice[]
  /** What the centre says when nothing is pointed at, e.g. "Orders". */
  total: string
  unit?: string
  formatValue?: (n: number) => string
  empty?: string
}) {
  const [active, setActive] = useState<string | null>(null)
  const sum = slices.reduce((n, s) => n + s.value, 0)
  const live = slices.filter((s) => s.value > 0)
  const size = 2 * R + 4
  const c = size / 2

  let angle = -Math.PI / 2
  const arcs = live.map((s) => {
    const sweep = (s.value / sum) * Math.PI * 2
    const gap = live.length > 1 ? GAP_PX / R : 0
    const a0 = angle + gap / 2
    const a1 = angle + sweep - gap / 2
    angle += sweep
    return { s, d: live.length === 1 ? null : arc(c, c, a0, Math.max(a0 + 0.001, a1)) }
  })
  const shown = slices.find((s) => s.key === active)

  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
      <div className="relative shrink-0" style={{ width: size, height: size }} onPointerLeave={() => setActive(null)}>
        <svg width={size} height={size} role="img" aria-label={`${totalLabel}: ${sum > 0 ? slices.map((s) => `${s.label} ${formatValue(s.value)}`).join(', ') : empty}`}>
          {sum === 0 ? (
            <circle cx={c} cy={c} r={R - THICK / 2} fill="none" stroke="var(--viz-grid)" strokeWidth={THICK} />
          ) : (
            arcs.map(({ s, d }) =>
              d === null ? (
                <circle key={s.key} cx={c} cy={c} r={R - THICK / 2} fill="none" stroke={s.color} strokeWidth={THICK} />
              ) : (
                <path
                  key={s.key}
                  d={d}
                  fill={s.color}
                  opacity={active && active !== s.key ? 0.45 : 1}
                  tabIndex={0}
                  aria-label={`${s.label}: ${formatValue(s.value)}, ${percentOf(s.value, sum)}`}
                  className="outline-none transition-opacity duration-150 focus-visible:stroke-foreground"
                  strokeWidth={2}
                  stroke="transparent"
                  onPointerEnter={() => setActive(s.key)}
                  onFocus={() => setActive(s.key)}
                  onBlur={() => setActive(null)}
                />
              ),
            )
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="max-w-24">
            <p className="font-display text-2xl leading-none font-semibold tracking-[-0.02em]">{formatValue(shown ? shown.value : sum)}</p>
            <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{shown ? `${shown.label} · ${percentOf(shown.value, sum)}` : sum === 0 ? empty : `${totalLabel}${unit ? ` ${unit}` : ''}`}</p>
          </div>
        </div>
      </div>
      <ul className="min-w-44 flex-1 space-y-0.5 text-sm">
        {slices.map((s) => (
          <li
            key={s.key}
            className={cn('flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors', active === s.key && 'bg-accent')}
            onPointerEnter={() => setActive(s.key)}
            onPointerLeave={() => setActive(null)}
          >
            <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate [overflow-wrap:anywhere]" title={s.label}>{s.label}</span>
            <span className="font-medium tabular-nums">{formatValue(s.value)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{percentOf(s.value, sum)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
