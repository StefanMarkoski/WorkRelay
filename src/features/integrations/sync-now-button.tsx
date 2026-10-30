import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { useNow } from '@/lib/use-now'
import { useIntegrations } from './queries'
import { shopLabel } from './shop-label'
import { useIntegrationSyncs, useSyncNow } from './sync'
import { callsLeftText, syncNowState } from './sync-now-state'

const COOLDOWN_MS = 60_000 // matches the server, which refuses a second call within a minute

/**
 * "Sync now" for one shop, or for every shop that can be synced. It is the scheduled pull started by hand: it only works where
 * the platform admin has set a schedule for the shop, the products URL is in, and the shop is not paused, and each press takes
 * one call from the shop's budget. Only owners and admins get the button; everyone else sees when stock was last checked.
 */
export function SyncNowControl({ shopId, className }: { shopId: string; className?: string }) {
  const { canManage } = useWorkspace()
  const shops = useIntegrations().data ?? []
  const syncs = useIntegrationSyncs().data ?? []
  const syncNow = useSyncNow()
  const now = useNow(10_000)
  const [busy, setBusy] = useState(false)
  const [coolUntil, setCoolUntil] = useState(0)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const targets = (shopId ? shops.filter((s) => s.id === shopId) : shops.filter((s) => s.status === 'connected')).map((shop) => {
    const sync = syncs.find((x) => x.integration_id === shop.id) ?? null
    return { shop, sync, state: syncNowState(sync, now) }
  })
  const eligible = targets.filter((t) => t.state.available)
  const lastChecked = targets.reduce<string | null>((latest, t) => (t.sync?.last_sync_at && (!latest || t.sync.last_sync_at > latest) ? t.sync.last_sync_at : latest), null)
  const cooling = now < coolUntil
  const firstRefusal = targets.find((t) => !t.state.available)?.state

  async function run() {
    setBusy(true)
    setMessage(null)
    const done: string[] = []
    const problems: string[] = []
    for (const t of eligible) {
      try {
        const r = await syncNow(t.shop.id)
        if (r.status === 'ok') done.push(`${shopLabel(t.shop)}: ${r.products ?? 0} products`)
        else problems.push(`${shopLabel(t.shop)}: ${r.error ?? 'the shop did not answer correctly'}`)
      } catch (e) {
        problems.push(`${shopLabel(t.shop)}: ${e instanceof Error ? e.message : 'could not sync'}`)
      }
    }
    setBusy(false)
    setCoolUntil(now + COOLDOWN_MS) // the clock below ticks every 10s; the server enforces the real minute
    if (problems.length === 0) setMessage({ tone: 'ok', text: eligible.length === 1 ? `Done. ${done[0].split(': ')[1]} updated.` : `Done. ${done.join('; ')}.` })
    else setMessage({ tone: 'error', text: [...problems, ...(done.length ? [`Updated: ${done.join('; ')}`] : [])].join(' · ') })
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {lastChecked ? `Stock checked ${timeAgo(lastChecked)}` : 'Stock has not been checked yet'}
          {canManage && eligible.length === 1 && eligible[0].state.available && eligible[0].sync?.days
            ? ` · ${callsLeftText(eligible[0].state, eligible[0].sync.days)}`
            : ''}
          {canManage && !shopId && eligible.length > 0 && eligible.length < targets.length
            ? ` · ${targets.length - eligible.length} shop${targets.length - eligible.length === 1 ? '' : 's'} skipped (see Settings → API Calls → Inventory)`
            : ''}
        </p>
        {canManage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || cooling || eligible.length === 0}
            onClick={run}
            title={eligible.length === 0 ? firstRefusal && !firstRefusal.available ? firstRefusal.reason : undefined : undefined}
          >
            <RefreshCw className={busy ? 'animate-spin' : undefined} />
            {busy ? 'Syncing…' : eligible.length > 1 ? `Sync ${eligible.length} shops now` : 'Sync now'}
          </Button>
        )}
      </div>
      {canManage && eligible.length === 0 && firstRefusal && !firstRefusal.available && (
        <p className="mt-1.5 max-w-xl text-xs text-muted-foreground">{targets.length > 1 ? `No shop can be synced right now. ${firstRefusal.reason}` : firstRefusal.reason}</p>
      )}
      {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`mt-1.5 text-xs ${message.tone === 'error' ? 'text-destructive' : 'text-success'}`}>{message.text}</p>}
    </div>
  )
}
