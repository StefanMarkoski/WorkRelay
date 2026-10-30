import { useState, type PointerEvent } from 'react'
import { ChartTooltip, TooltipRow } from './chart-tooltip'
import { formatCompact, niceTicks } from './scale'
import { useWidth } from './use-size'

export interface StepPoint {
  /** Epoch ms of the change. */
  t: number
  v: number
}

const M = { top: 10, right: 12, bottom: 26 }

/**
 * A level that holds until the next change, drawn as steps (stock on hand is not a smooth curve). An optional reference
 * line marks a threshold. One y axis from zero. Hover finds the nearest change; the table view lists every one.
 */
export function StepChart({
  points,
  now,
  threshold: refLine,
  color = 'var(--series-1)',
  formatValue,
  label,
  height = 200,
}: {
  points: StepPoint[]
  /** The right edge: where the last level is held to. */
  now: number
  threshold?: { value: number; label: string }
  color?: string
  formatValue: (n: number) => string
  label: string
  height?: number
}) {
  const [box, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)
  const pts = [...points].sort((a, b) => a.t - b.t)
  const peak = Math.max(0, ...pts.map((p) => p.v), refLine?.value ?? 0)
  const ticks = niceTicks(peak)
  const top = ticks[ticks.length - 1]
  const left = 10 + Math.max(...ticks.map((t) => formatCompact(t).length)) * 6.6
  const innerW = Math.max(0, width - left - M.right)
  const innerH = height - M.top - M.bottom
  const t0 = pts[0]?.t ?? now
  const span = Math.max(1, now - t0)
  const x = (t: number) => left + ((t - t0) / span) * innerW
  const y = (v: number) => M.top + innerH - (v / top) * innerH

  let d = ''
  pts.forEach((p, i) => {
    d += i === 0 ? `M${x(p.t)},${y(p.v)}` : ` H${x(p.t)} V${y(p.v)}`
  })
  if (pts.length) d += ` H${x(now)}`

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect()
    const t = t0 + ((e.clientX - r.left - left) / (innerW || 1)) * span
    let best = 0
    pts.forEach((p, i) => { if (Math.abs(p.t - t) < Math.abs(pts[best].t - t)) best = i })
    setActive(best)
  }
  const date = (t: number) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(t))
  const ap = active !== null ? pts[active] : null

  return (
    <div ref={box} className="relative" style={{ height }} onPointerLeave={() => setActive(null)}>
      {width > 0 && pts.length > 0 && (
        <svg width={width} height={height} role="img" aria-label={label} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
              <text x={left - 8} y={y(t)} textAnchor="end" dominantBaseline="central" className="fill-muted-foreground text-[11px]" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCompact(t)}</text>
            </g>
          ))}
          {[0, 1 / 3, 2 / 3, 1].map((f, i) => (
            <text key={i} x={left + f * innerW} y={height - 7} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]">{date(t0 + f * span)}</text>
          ))}
          {refLine && (
            <g>
              <line x1={left} x2={left + innerW} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--warning)" strokeWidth={1} />
              <text x={left + innerW} y={y(refLine.value) - 5} textAnchor="end" className="fill-muted-foreground text-[11px]">{refLine.label}</text>
            </g>
          )}
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          {ap && <line x1={x(ap.t)} x2={x(ap.t)} y1={M.top} y2={M.top + innerH} stroke="var(--viz-axis)" strokeWidth={1} />}
          <circle cx={x(ap ? ap.t : now)} cy={y(ap ? ap.v : pts[pts.length - 1].v)} r={4} fill={color} stroke="var(--card)" strokeWidth={2} />
          <rect x={left} y={M.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} />
        </svg>
      )}
      {ap && (
        <ChartTooltip x={x(ap.t)} y={M.top + 4} width={width}>
          <p className="mb-1 font-medium text-foreground">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ap.t))}</p>
          <TooltipRow color={color} label="in stock" value={formatValue(ap.v)} />
        </ChartTooltip>
      )}
    </div>
  )
}
