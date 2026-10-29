import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, humanize } from '@/lib/format'
import type { OrderEvent } from '@/types/db'

function describe(e: OrderEvent): string {
  if (e.type === 'note.added') return String(e.data.note ?? '')
  const applied = (e.data.applied as string[] | undefined) ?? []
  const stale = (e.data.stale as string[] | undefined) ?? []
  const parts: string[] = []
  if (e.data.status_to) parts.push(`Status ${e.data.status_from ? `${e.data.status_from} → ` : 'set to '}${e.data.status_to}`)
  if (applied.length) parts.push(`Updated: ${applied.map((a) => a.replace(/_/g, ' ')).join(', ')}`)
  if (stale.length) parts.push(`Ignored as outdated: ${stale.map((a) => a.replace(/_/g, ' ')).join(', ')}`)
  return parts.join(' · ')
}

const EVENT_CAP = 50

export function OrderTimeline({ events }: { events: OrderEvent[] }) {
  const [showAll, setShowAll] = useState(false)
  if (events.length === 0) return <p className="p-4 text-sm text-muted-foreground">No events recorded.</p>
  return (
    <ol className="space-y-4 p-4">
      {(showAll ? events : events.slice(0, EVENT_CAP)).map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className={`mt-1.5 size-2 shrink-0 rounded-full ${e.source === 'external' ? 'bg-muted-foreground' : 'bg-info'}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{humanize(e.type.replace('.', ' '))}</span>
              <Badge tone={e.source === 'external' ? 'neutral' : 'info'}>
                {e.source === 'external' ? 'Reported by store' : 'Action in WorkRelay'}
              </Badge>
            </div>
            {describe(e) && <p className="mt-0.5 text-sm text-muted-foreground break-words">{describe(e)}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</p>
          </div>
        </li>
      ))}
      {!showAll && events.length > EVENT_CAP && (
        <li>
          <Button variant="outline" size="sm" onClick={() => setShowAll(true)}>Show all {events.length.toLocaleString()} events</Button>
        </li>
      )}
    </ol>
  )
}
