import type { ReactNode } from 'react'

export interface LegendItem {
  key: string
  label: string
  color: string
  /** rect for bars and areas, line for lines. */
  shape?: 'rect' | 'line'
  /** A status chart pairs its colour with an icon, so colour is never the only signal. */
  icon?: ReactNode
}

/** Two or more series always get a legend: the colour-independent way to say which is which. */
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          {i.icon ?? <span aria-hidden className={i.shape === 'line' ? 'h-0.5 w-3 rounded-full' : 'size-2.5 rounded-[2px]'} style={{ background: i.color }} />}
          <span>{i.label}</span>
        </li>
      ))}
    </ul>
  )
}
