import { Check } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { statusTone } from '@/components/common/status-badge'
import { formatDateTime, humanize } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { OrderEvent } from '@/types/db'

const MAX_STEPS = 8

const DOT: Record<string, string> = { neutral: 'bg-foreground', info: 'bg-info', success: 'bg-success', warning: 'bg-warning', danger: 'bg-destructive' }

export interface StatusStep { id: string; status: string; at: string; by: string }

/** Who an event came from: the store, or the member behind a WorkRelay action. */
export const author = (e: OrderEvent, people: Record<string, string>) =>
  e.source === 'external' ? 'Store' : (e.actor_user_id && people[e.actor_user_id]) || 'A former team member'

/** The order's status over time, oldest first. Events that did not change the status are left out. */
export function statusSteps(events: OrderEvent[], people: Record<string, string>): StatusStep[] {
  const steps: StatusStep[] = []
  const changes = events
    .filter((e) => typeof e.data.status_to === 'string' && e.data.status_to)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at))
  for (const e of changes) {
    const status = String(e.data.status_to)
    if (steps.at(-1)?.status === status) continue
    steps.push({ id: e.id, status, at: e.occurred_at, by: author(e, people) })
  }
  return steps
}

/** A short row of steps, one per status the order has been in, with who moved it and when. The last one is current. */
export function StatusHistory({ events, people }: { events: OrderEvent[]; people: Record<string, string> }) {
  const all = statusSteps(events, people)
  const row = useRef<HTMLOListElement>(null)
  // On a narrow screen the row scrolls; start at the end, where the current status is.
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (row.current) row.current.scrollLeft = row.current.scrollWidth })
    return () => cancelAnimationFrame(frame)
  }, [all.length])
  if (all.length === 0) return null
  const steps = all.slice(-MAX_STEPS)
  return (
    <Card>
      <CardHeader><CardTitle>Status history</CardTitle></CardHeader>
      <ol ref={row} className="flex overflow-x-auto px-4 py-5">
        {steps.map((s, i) => {
          const current = i === steps.length - 1
          return (
            <li key={s.id} className="relative min-w-36 flex-1 pr-4 last:min-w-28 last:flex-none">
              {!current && <span aria-hidden className="absolute top-3 left-8 right-2 h-px bg-border" />}
              <span
                aria-hidden
                className={cn('relative grid size-6 place-items-center rounded-full', current ? DOT[statusTone(s.status)] : 'border bg-background text-muted-foreground')}
              >
                {current ? <span className="size-2 rounded-full bg-background" /> : <Check className="size-3" />}
              </span>
              <p className="mt-3 text-xs text-muted-foreground">{formatDateTime(s.at)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-medium">
                {humanize(s.status)}
                {current && <Badge>Current</Badge>}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]" title={s.by}>{s.by}</p>
            </li>
          )
        })}
      </ol>
      {all.length > steps.length && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">{all.length - steps.length} earlier status changes are in the timeline below.</p>
      )}
    </Card>
  )
}
