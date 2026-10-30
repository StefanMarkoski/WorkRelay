import { useState } from 'react'
import { ChartTooltip } from './chart-tooltip'
import { formatFull } from './scale'
import { useWidth } from './use-size'

export interface HeatCell {
  dow: number // 0 = Sunday
  hour: number // 0-23
  value: number
}

// Monday first, since a shop week starts there
const ROWS = [1, 2, 3, 4, 5, 6, 0]
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LABEL_W = 36
const CELL_H = 22
const HEAD_H = 20
const GAP = 2

/** The hour of the day, in the viewer's own clock style: "9 AM" or "09:00". */
const hourLabel = (h: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 1, h)))

/**
 * When orders arrive: weekday by hour, one hue from faint to strong, an empty hour left blank. The count is in every
 * cell's hover and in the table view, so the shade is never the only way to read it.
 */
export function Heatmap({ cells, unit = 'orders' }: { cells: HeatCell[]; unit?: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null)
  const at = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.value]))
  const max = Math.max(0, ...cells.map((c) => c.value))
  const cw = Math.max(6, (width - LABEL_W) / 24)
  const height = HEAD_H + ROWS.length * CELL_H
  const shade = (v: number) => (v <= 0 ? 'var(--secondary)' : `color-mix(in oklab, var(--series-1) ${Math.round(22 + (v / max) * 78)}%, var(--card))`)
  const v = hover ? at.get(`${hover.dow}-${hover.hour}`) ?? 0 : 0

  return (
    <div ref={ref} className="relative" style={{ height }} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Orders by weekday and hour. ${max === 0 ? 'No orders in this period.' : `The busiest hour has ${formatFull(max)} ${unit}.`}`} className="block">
          {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => (
            <text key={h} x={LABEL_W + h * cw} y={12} className="fill-muted-foreground text-[10px]">{hourLabel(h)}</text>
          ))}
          {ROWS.map((dow, r) => (
            <g key={dow}>
              <text x={0} y={HEAD_H + r * CELL_H + CELL_H / 2} dominantBaseline="central" className="fill-muted-foreground text-[11px]">{DAY_NAMES[dow]}</text>
              {Array.from({ length: 24 }, (_, h) => {
                const value = at.get(`${dow}-${h}`) ?? 0
                return (
                  <rect
                    key={h}
                    x={LABEL_W + h * cw}
                    y={HEAD_H + r * CELL_H}
                    width={Math.max(1, cw - GAP)}
                    height={CELL_H - GAP}
                    rx={3}
                    fill={shade(value)}
                    stroke={hover?.dow === dow && hover.hour === h ? 'var(--foreground)' : 'none'}
                    strokeWidth={1.5}
                    tabIndex={0}
                    aria-label={`${DAY_NAMES[dow]} ${hourLabel(h)}: ${formatFull(value)} ${unit}`}
                    className="outline-none"
                    onPointerEnter={() => setHover({ dow, hour: h })}
                    onFocus={() => setHover({ dow, hour: h })}
                    onBlur={() => setHover(null)}
                  />
                )
              })}
            </g>
          ))}
        </svg>
      )}
      {hover && (
        <ChartTooltip x={LABEL_W + (hover.hour + 0.5) * cw} y={HEAD_H + ROWS.indexOf(hover.dow) * CELL_H + CELL_H + 4} width={width}>
          <p className="font-medium text-foreground">{DAY_NAMES[hover.dow]}, {hourLabel(hover.hour)}</p>
          <p className="text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{formatFull(v)}</span> {unit}</p>
        </ChartTooltip>
      )}
    </div>
  )
}

/** The scale under a heatmap: faint to strong, with the largest cell's value. */
export function HeatScale({ max, unit = 'orders' }: { max: number; unit?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>None</span>
      <span aria-hidden className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(to right, var(--secondary), color-mix(in oklab, var(--series-1) 22%, var(--card)), var(--series-1))' }} />
      <span>{formatFull(max)} {unit} in the busiest hour</span>
    </div>
  )
}
