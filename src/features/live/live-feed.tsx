import { CheckSquare, Play, ShoppingCart } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { useIntegrations } from '@/features/integrations/queries'
import { shopLabel } from '@/features/integrations/shop-label'
import { useLiveStatus } from '@/features/realtime/live-status'
import { useLiveItems, type LiveItem } from './live-data'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

const ICON: Record<LiveItem['kind'], ReactNode> = {
  order: <ShoppingCart className="size-3.5" />,
  run: <Play className="size-3.5" />,
  approval: <CheckSquare className="size-3.5" />,
}

/** Re-renders on a timer so "5s ago" keeps counting without a refetch. */
function useTick(ms: number) {
  const [, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

/**
 * What is happening now: new orders, automation runs and approval requests in one list, newest first. It updates through
 * Realtime, so a new row appears (and is briefly tinted) without a reload; the lamp says whether that connection is up.
 */
export function LiveFeed({ shopId, className }: { shopId: string; className?: string }) {
  const q = useLiveItems(shopId)
  const status = useLiveStatus()
  const shops = useIntegrations().data ?? []
  const showShop = shops.filter((s) => s.status === 'connected').length > 1
  useTick(15_000)

  // Rows that were not there before are "new" and get a short tint. The first load never counts (nothing is new yet).
  const known = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set())
  const items = q.data ?? []
  useEffect(() => {
    if (!q.data) return
    const ids = q.data.map((i) => i.id)
    const added = known.current ? ids.filter((id) => !known.current!.has(id)) : []
    known.current = new Set(ids)
    if (added.length === 0) return
    setFresh(new Set(added))
    const t = setTimeout(() => setFresh(new Set()), 2000)
    return () => clearTimeout(t)
  }, [q.data])

  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 className="text-sm font-semibold">Live</h2>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <span aria-hidden className={cn('size-2 rounded-full', status === 'live' ? 'bg-success' : status === 'connecting' ? 'bg-warning' : 'bg-destructive')} />
          {status === 'live' ? 'Updating as it happens' : status === 'connecting' ? 'Connecting' : 'Not live, refreshing every 30s'}
        </span>
      </div>
      {q.isLoading ? (
        <ul className="space-y-1 p-3" aria-hidden>{Array.from({ length: 6 }, (_, i) => <li key={i} className="h-12 animate-pulse rounded-md bg-secondary/60" />)}</ul>
      ) : q.error ? (
        <ErrorState onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">Nothing yet. New orders, automation runs and approval requests appear here the moment they happen.</p>
      ) : (
        <ul className="max-h-[27rem] divide-y overflow-y-auto" aria-live="polite" aria-relevant="additions">
          {items.map((i) => (
            <li key={i.id} className={cn(fresh.has(i.id) && 'live-new')}>
              <Link to={i.to} className="flex items-start gap-3 px-5 py-3 outline-none hover:bg-accent/50 focus-visible:bg-accent/50">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border bg-secondary text-muted-foreground">{ICON[i.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] font-medium [overflow-wrap:anywhere]">{i.title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    {i.status && <StatusBadge status={i.status} />}
                    <span>{timeAgo(i.at)}{showShop && i.shopId ? ` · ${((s) => (s ? shopLabel(s) : ''))(shops.find((x) => x.id === i.shopId))}` : ''}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
