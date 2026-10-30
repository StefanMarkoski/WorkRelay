import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { formatFull } from './scale'

export interface BarItem {
  key: string
  label: string
  /** Secondary text under the label, e.g. the shop. */
  detail?: string
  value: number
  to?: string
}

/**
 * Ranked horizontal bars, the right chart for "which is biggest": one baseline, so close values compare exactly.
 * Every row prints its value, so nothing needs hovering. One colour, because rank is already in the order.
 */
export function BarList({ items, format = formatFull, color = 'var(--series-1)', empty }: { items: BarItem[]; format?: (n: number) => string; color?: string; empty: ReactNode }) {
  const max = Math.max(0, ...items.map((i) => i.value))
  if (items.length === 0 || max === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  return (
    <ol className="space-y-3">
      {items.map((i) => (
        <li key={i.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5">
          <div className="min-w-0">
            {i.to ? (
              <Link to={i.to} className="block truncate text-sm font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground" title={i.label}>{i.label}</Link>
            ) : (
              <span className="block truncate text-sm font-medium" title={i.label}>{i.label}</span>
            )}
            {i.detail && <span className="block truncate text-[11px] text-muted-foreground" title={i.detail}>{i.detail}</span>}
          </div>
          <span className="text-sm font-medium tabular-nums">{format(i.value)}</span>
          <div className="col-span-2 h-2 rounded-full bg-secondary" role="img" aria-label={`${i.label}: ${format(i.value)}`}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (i.value / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ol>
  )
}
