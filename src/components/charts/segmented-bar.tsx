import { useState, type ReactNode } from 'react'
import { ChartTooltip } from './chart-tooltip'
import { formatFull, percentOf } from './scale'
import { useWidth } from './use-size'

export interface SegmentPart {
  key: string
  label: string
  value: number
  color: string
  /** The ink on the block: white, or near-black on a light fill. */
  ink?: string
  icon?: ReactNode
}

/**
 * One whole split into a few parts, as one bar. Widths are proportional; a part at zero draws nothing; a label sits inside
 * a block only if it fits, otherwise the legend and the hover carry it. The legend lists names (and an icon for states),
 * so colour is never the only signal.
 */
export function SegmentedBar({ parts, format = formatFull, label }: { parts: SegmentPart[]; format?: (n: number) => string; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const sum = parts.reduce((n, p) => n + p.value, 0)
  const live = parts.filter((p) => p.value > 0)
  const shown = parts.find((p) => p.key === hover)
  const x = shown ? (live.slice(0, live.indexOf(shown)).reduce((n, p) => n + p.value, 0) + shown.value / 2) / sum : 0

  return (
    <div>
      <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
        <div className="flex h-7 gap-0.5 overflow-hidden rounded-md" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${format(p.value)}`).join(', ')}`}>
          {sum === 0 ? (
            <div className="h-full w-full rounded-md bg-secondary" />
          ) : (
            live.map((p) => {
              const px = (p.value / sum) * width
              const text = format(p.value)
              return (
                <div
                  key={p.key}
                  tabIndex={0}
                  aria-label={`${p.label}: ${text}, ${percentOf(p.value, sum)}`}
                  className="flex min-w-1 items-center overflow-hidden rounded-[4px] px-2 text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                  style={{ width: `${(p.value / sum) * 100}%`, background: p.color, color: p.ink ?? '#fff', opacity: hover && hover !== p.key ? 0.6 : 1 }}
                  onPointerEnter={() => setHover(p.key)}
                  onFocus={() => setHover(p.key)}
                  onBlur={() => setHover(null)}
                >
                  {px > text.length * 7.5 + 20 ? text : null}
                </div>
              )
            })
          )}
        </div>
        {shown && sum > 0 && (
          <ChartTooltip x={x * width} y={36} width={width}>
            <p className="font-medium text-foreground">{shown.label}</p>
            <p className="text-muted-foreground"><span className="font-medium tabular-nums text-foreground">{format(shown.value)}</span> · {percentOf(shown.value, sum)}</p>
          </ChartTooltip>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            {p.icon ?? <span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: p.color }} />}
            <span>{p.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
