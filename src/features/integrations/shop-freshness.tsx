import { useIntegrations } from './queries'
import { shopLabel } from './shop-label'
import { useIntegrationSyncs } from './sync'
import { freshnessText, lastSynced } from './sync-freshness'
import { formatDateTime } from '@/lib/format'
import { useNow } from '@/lib/use-now'

/**
 * When each shop was last synced, whichever way it happened: WorkRelay checked it, or the shop pushed (and who pressed the
 * button, when the shop said so). One shop reads "Synced 12m ago, sent by Marko (Admin)"; several are listed with their names
 * and currencies, so "which shop is stale?" is answered at a glance. Everyone in the workspace sees it.
 */
export function ShopFreshness({ shopId, className }: { shopId: string; className?: string }) {
  const shops = useIntegrations().data ?? []
  const syncs = useIntegrationSyncs().data ?? []
  useNow(30_000) // the "12m ago" keeps counting without a refetch

  const targets = (shopId ? shops.filter((s) => s.id === shopId) : shops.filter((s) => s.status === 'connected')).map((shop) => ({
    shop,
    fresh: lastSynced(syncs.find((x) => x.integration_id === shop.id)),
  }))
  if (targets.length === 0) return null
  const named = targets.length > 1

  return (
    <ul className={className ?? 'space-y-0.5'} aria-label="When each shop last synced">
      {targets.map(({ shop, fresh }) => {
        const text = freshnessText(fresh)
        return (
          <li key={shop.id} className="text-xs text-muted-foreground" title={fresh.at ? formatDateTime(fresh.at) : undefined}>
            {named ? (
              <>
                <span className="font-medium text-foreground">{shopLabel(shop)}: </span>
                {text}
              </>
            ) : (
              text.charAt(0).toUpperCase() + text.slice(1)
            )}
          </li>
        )
      })}
    </ul>
  )
}
