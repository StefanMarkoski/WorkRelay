import { useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { formatDay, formatDayLong } from '@/features/insights/series'
import { ChartTooltip, TooltipRow } from './chart-tooltip'
import { formatCompact, niceTicks } from './scale'
import { useWidth } from './use-size'

export interface ChartSeries {
  key: string
  label: string
  /** A CSS colour, normally one of the --series-n variables, or a status colour for state charts. */
  color: string
  /** One value per day, in the same order as `days`. */
  values: number[]
}

const M = { top: 10, right: 10, bottom: 26 }
const GAP = 2 // the surface-coloured gap between touching marks

/** A path for a column whose top corners are rounded and whose bottom sits square on the baseline. */
function columnPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

/**
 * Values over days. `columns` is one series as bars; `stacked` is several series on top of each other (the total is what
 * the height shows); `line` draws each series as a 2px line. One y axis, always starting at zero. Hover or keyboard
 * (arrow keys) reads out every series for the day; the table view in ChartCard carries the same numbers.
 */
export function BucketChart({
  days,
  series,
  kind,
  formatValue,
  formatAxis = formatCompact,
  height = 232,
  label,
  area = false,
  emptyText = 'No activity in this period',
  readoutExtra,
}: {
  days: string[]
  series: ChartSeries[]
  kind: 'columns' | 'stacked' | 'line'
  formatValue: (n: number) => string
  formatAxis?: (n: number) => string
  height?: number
  label: string
  area?: boolean
  emptyText?: string
  /** Extra line in the readout for a day, e.g. a total. */
  readoutExtra?: (index: number) => ReactNode
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const n = days.length

  const totals = useMemo(() => days.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0)), [days, series])
  const peak = kind === 'stacked' ? Math.max(0, ...totals) : Math.max(0, ...series.flatMap((s) => s.values))
  const ticks = niceTicks(peak)
  const top = ticks[ticks.length - 1]
  const empty = peak === 0

  const left = 10 + Math.max(...ticks.map((t) => formatAxis(t).length)) * 6.6
  const innerW = Math.max(0, width - left - M.right)
  const innerH = height - M.top - M.bottom
  const band = n > 0 ? innerW / n : 0
  const cx = (i: number) => left + band * (i + 0.5)
  const y = (v: number) => M.top + innerH - (v / top) * innerH

  // Label the latest day and walk back, so the most recent end always has a date and none overlap.
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 68))))
  const labelled = days.map((_, i) => i).filter((i) => (n - 1 - i) % every === 0)

  const at = (clientX: number, el: Element) => {
    const rect = el.getBoundingClientRect()
    return Math.min(n - 1, Math.max(0, Math.floor(((clientX - rect.left - left) / (innerW || 1)) * n)))
  }
  const onMove = (e: PointerEvent<SVGRectElement>) => setActive(at(e.clientX, e.currentTarget.ownerSVGElement ?? e.currentTarget))
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'Home' ? -n : e.key === 'End' ? n : 0
    if (!step) return
    e.preventDefault()
    setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + step)))
  }

  const bw = Math.min(24, Math.max(2, band * 0.62))
  const ready = width > 0 && n > 0

  return (
    <div
      ref={ref}
      className="relative outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      style={{ height }}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Use the arrow keys to read each day.`}
      onKeyDown={onKey}
      onFocus={() => setActive((a) => a ?? n - 1)}
      onBlur={() => setActive(null)}
      onPointerLeave={() => setActive(null)}
    >
      {ready && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
              <text x={left - 8} y={y(t)} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatAxis(t)}
              </text>
            </g>
          ))}
          {labelled.map((i) => (
            <text key={i} x={cx(i)} y={height - 7} textAnchor="middle" className="fill-muted-foreground text-[11px]">{formatDay(days[i])}</text>
          ))}

          {active !== null && kind !== 'line' && <rect x={left + band * active} y={M.top} width={band} height={innerH} className="fill-foreground" opacity={0.06} />}
          {active !== null && kind === 'line' && <line x1={cx(active)} x2={cx(active)} y1={M.top} y2={M.top + innerH} stroke="var(--viz-axis)" strokeWidth={1} />}

          {kind === 'columns' && series[0] && series[0].values.map((v, i) => v > 0 && (
            <path key={i} d={columnPath(cx(i) - bw / 2, y(v), bw, M.top + innerH - y(v), 4)} fill={series[0].color} />
          ))}

          {kind === 'stacked' && days.map((_, i) => {
            let base = 0
            const live = series.filter((s) => (s.values[i] ?? 0) > 0)
            return live.map((s, k) => {
              const v = s.values[i]
              const y1 = y(base + v)
              const y0 = y(base)
              base += v
              const isTop = k === live.length - 1
              const h = Math.max(1, y0 - y1 - (k > 0 ? GAP : 0)) // a 2px surface gap above the segment below it
              const yy = y0 - h
              return <path key={`${i}-${s.key}`} d={isTop ? columnPath(cx(i) - bw / 2, yy, bw, h, 4) : `M${cx(i) - bw / 2},${yy} h${bw} v${h} h${-bw} Z`} fill={s.color} />
            })
          })}

          {kind === 'line' && series.map((s, si) => {
            const pts = s.values.map((v, i) => `${cx(i)},${y(v)}`)
            return (
              <g key={s.key}>
                {area && si === 0 && <path d={`M${cx(0)},${y(0)} L${pts.join(' L')} L${cx(n - 1)},${y(0)} Z`} fill={s.color} opacity={0.1} />}
                <path d={`M${pts.join(' L')}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {/* End dot (r 4) with a 2px surface ring; on hover each series gets one at the day under the pointer */}
                <circle cx={cx(active ?? n - 1)} cy={y(s.values[active ?? n - 1] ?? 0)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
              </g>
            )
          })}

          {empty && (
            <text x={left + innerW / 2} y={M.top + innerH / 2} textAnchor="middle" className="fill-muted-foreground text-xs">{emptyText}</text>
          )}
          {/* The hit area is the whole plot, so a mark never has to be hit dead-centre */}
          <rect x={left} y={M.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} />
        </svg>
      )}
      {ready && active !== null && !empty && (
        <ChartTooltip x={cx(active)} y={M.top + 4} width={width}>
          <p className="mb-1 font-medium text-foreground">{formatDayLong(days[active])}</p>
          {[...(kind === 'stacked' ? [...series].reverse() : series)].map((s) => (
            <TooltipRow key={s.key} color={s.color} label={s.label} value={formatValue(s.values[active] ?? 0)} shape={kind === 'line' ? 'line' : 'rect'} />
          ))}
          {kind === 'stacked' && series.length > 1 && (
            <p className="mt-1 border-t pt-1 text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{formatValue(totals[active])}</span> total</p>
          )}
          {readoutExtra?.(active)}
        </ChartTooltip>
      )}
    </div>
  )
}
