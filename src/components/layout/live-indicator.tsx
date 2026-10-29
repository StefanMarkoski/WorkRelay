import { cn } from '@/lib/utils'
import type { LiveStatus } from '@/features/realtime/use-realtime-sync'

const COPY: Record<LiveStatus, { label: string; title: string; box: string; dot: string }> = {
  live: { label: 'Live', title: 'Orders and runs update automatically', box: 'text-foreground', dot: 'bg-success' },
  connecting: { label: 'Connecting', title: 'Connecting to live updates', box: 'text-foreground', dot: 'bg-warning' },
  offline: { label: 'Not live', title: 'Live updates are off; the page still refreshes every 30 seconds', box: 'text-foreground', dot: 'bg-destructive' },
}

export function LiveIndicator({ status }: { status: LiveStatus }) {
  const c = COPY[status]
  return (
    <span title={c.title} role="status" className={cn('hidden items-center gap-2.5 rounded-md border bg-card px-3 py-1.5 text-[13px] font-medium md:inline-flex', c.box)}>
      <span aria-hidden className="relative flex size-3 shrink-0">
        {/* Expanding ring while live. Reduced-motion users get a still dot (see the global rule in index.css). */}
        {status === 'live' && <span className={cn('live-ring absolute inline-flex size-full rounded-full', c.dot)} />}
        <span className={cn('relative inline-flex size-3 rounded-full', c.dot)} />
      </span>
      {c.label}
    </span>
  )
}
