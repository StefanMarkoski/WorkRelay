import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ErrorState } from '@/components/common/states'
import { Switch } from '@/components/ui/switch'
import { ProductFeed } from '@/features/integrations/product-feed'
import { useIntegrationSyncs } from '@/features/integrations/sync'
import { StockWriteBack } from '@/features/integrations/stock-write-back'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'

/** Everything about this shop's stock in one place: the product feed WorkRelay reads, the estimate between syncs, and write-back. */
export function InventoryTab({ shop }: { shop: Integration }) {
  const { current, canManage } = useWorkspace()
  const qc = useQueryClient()
  const syncs = useIntegrationSyncs()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setEstimate(on: boolean) {
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('set_integration_estimate_stock', { p_id: shop.id, p_enabled: on })
    setBusy(false)
    if (rpcError) return setError(errorMessage(rpcError))
    void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
    void qc.invalidateQueries({ queryKey: ['stock-estimates'] })
  }

  return (
    <div className="space-y-8">
      {syncs.error ? <ErrorState onRetry={() => void syncs.refetch()} /> : (
        <ProductFeed shop={shop} sync={(syncs.data ?? []).find((s) => s.integration_id === shop.id) ?? null} />
      )}

      <section aria-labelledby="estimate-title" className="max-w-3xl border-t pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="estimate-title" className="font-display text-lg font-semibold tracking-[-0.01em]">Estimate stock between syncs</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Optional. Next to the stock your shop reports, WorkRelay shows an estimate: the last reported number minus the pieces ordered since.
              Your shop stays the source of truth, and every new sync replaces the estimate. Cancelled and returned orders are not counted.
            </p>
          </div>
          <Switch checked={shop.estimate_stock} onChange={(on) => void setEstimate(on)} label="Estimate stock between syncs" disabled={!canManage || busy} />
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <section aria-labelledby="writeback-title" className="max-w-3xl border-t pt-6">
        <h2 id="writeback-title" className="sr-only">Stock write-back</h2>
        <StockWriteBack shop={shop} />
      </section>
    </div>
  )
}
