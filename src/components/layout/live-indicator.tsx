import { cn } from '@/lib/utils'
import type { LiveStatus } from '@/features/realtime/use-realtime-sync'

const COPY: Record<LiveStatus, { label: string; title: string }> = {
  live: { label: 'Live', title: 'Orders and runs update automatically' },
  connecting: { label: 'Connecting', title: 'Connecting to live updates' },
  offline: { label: 'Not live', title: 'Live updates are off; the page still refreshes every 30 seconds' },
}

export function LiveIndicator({ status }: { status: LiveStatus }) {
  return (
    <span title={COPY[status].title} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
      <span
        aria-hidden
        className={cn('size-2 rounded-full', status === 'live' && 'bg-success', status === 'connecting' && 'bg-warning', status === 'offline' && 'bg-destructive')}
      />
      {COPY[status].label}
    </span>
  )
}
