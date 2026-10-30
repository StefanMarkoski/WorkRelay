import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, humanize } from '@/lib/format'
import type { OrderEvent } from '@/types/db'
import { author } from './status-history'

export function describe(e: OrderEvent): string {
  if (e.type === 'note.added') return String(e.data.note ?? '')
  const applied = (e.data.applied as string[] | undefined) ?? []
  const stale = (e.data.stale as string[] | undefined) ?? []
  const parts: string[] = []
  const change = (label: string, from: unknown, to: unknown) => {
    if (to) parts.push(`${label} ${from ? `${humanize(String(from))} → ` : 'set to '}${humanize(String(to))}`)
  }
  change('Status', e.data.status_from, e.data.status_to)
  if (e.source === 'workrelay') {
    change('Payment', e.data.payment_from, e.data.payment_to)
    change('Fulfillment', e.data.fulfillment_from, e.data.fulfillment_to)
    if (e.data.note) parts.push(`Note: ${String(e.data.note)}`)
    return parts.join(' · ')
  }
  if (applied.length) parts.push(`Updated: ${applied.map((a) => a.replace(/_/g, ' ')).join(', ')}`)
  if (stale.length) parts.push(`Ignored as outdated: ${stale.map((a) => a.replace(/_/g, ' ')).join(', ')}`)
  return parts.join(' · ')
}

/** One line per field a manual edit changed, e.g. "Status Pending → Completed". */
export function editLines(e: OrderEvent): string[] {
  const out: string[] = []
  const line = (label: string, from: unknown, to: unknown) => {
    if (to) out.push(`${label} ${from ? `${humanize(String(from))} → ` : 'set to '}${humanize(String(to))}`)
  }
  line('Status', e.data.status_from, e.data.status_to)
  line('Payment', e.data.payment_from, e.data.payment_to)
  line('Fulfillment', e.data.fulfillment_from, e.data.fulfillment_to)
  return out
}

const EVENT_CAP = 50

/** An action taken in WorkRelay reads like a message: who, when, what they changed, and what they wrote. */
function Message({ e, people }: { e: OrderEvent; people: Record<string, string> }) {
  const name = author(e, people)
  const lines = e.type === 'note.added' ? [] : editLines(e)
  const text = String(e.data.note ?? '')
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-xs font-semibold text-background">
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium [overflow-wrap:anywhere]">{name}</span>
          <span className="text-muted-foreground">{e.type === 'note.added' ? 'added a note' : 'changed the order'}</span>
          <span className="text-xs text-muted-foreground">{formatDateTime(e.occurred_at)}</span>
        </p>
        {lines.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-sm">
            {lines.map((l) => <li key={l} className="[overflow-wrap:anywhere]">{l}</li>)}
          </ul>
        )}
        {text && <p className="mt-1.5 rounded-md border bg-muted/40 px-3 py-2 text-sm break-words whitespace-pre-wrap">{text}</p>}
      </div>
    </li>
  )
}

export function OrderTimeline({ events, people = {} }: { events: OrderEvent[]; people?: Record<string, string> }) {
  const [showAll, setShowAll] = useState(false)
  if (events.length === 0) return <p className="p-4 text-sm text-muted-foreground">No events recorded.</p>
  return (
    <ol className="space-y-4 p-4">
      {(showAll ? events : events.slice(0, EVENT_CAP)).map((e) => e.source === 'workrelay' ? <Message key={e.id} e={e} people={people} /> : (
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
