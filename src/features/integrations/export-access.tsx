import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'
import { functionsBaseUrl, useIntegrations } from './queries'

interface ExportCall {
  id: string
  resource: string
  status: 'started' | 'ok' | 'refused' | 'failed'
  reason: string | null
  row_count: number | null
  created_at: string
}

/**
 * Export for one shop: the shop reads its own orders, customers and products back, read-only. It is off until the workspace owner
 * switches it on, and it signs with the shop's one signing secret (General tab). Every rule is enforced by the database and the export
 * function; this panel only holds the switch and shows the recent calls.
 */
export function ExportAccess({ shop: initial }: { shop: Integration }) {
  const { current, isOwner, canManage } = useWorkspace()
  const qc = useQueryClient()
  const shop = useIntegrations().data?.find((s) => s.id === initial.id) ?? initial
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const calls = useQuery({
    queryKey: ['export-calls', shop.id, shop.export_enabled],
    enabled: canManage,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('export_calls')
        .select('id, resource, status, reason, row_count, created_at')
        .eq('integration_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(8)
      if (err) throw err
      return data as ExportCall[]
    },
  })

  async function setOn(on: boolean) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('set_export_enabled', { p_integration: shop.id, p_on: on })
    setBusy(false)
    if (err) setError(errorMessage(err))
    void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
    void qc.invalidateQueries({ queryKey: ['export-calls', shop.id] })
  }

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            Let this shop read its data back {shop.export_enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Optional, read-only, and off until the workspace owner switches it on. Then your shop (or a script you run) can fetch this shop&apos;s
            orders, customers and products, a page at a time. A call needs three things at once: this shop&apos;s key, a request signed with the
            shop&apos;s signing secret, and a number of calls left this hour (120). Anyone with only the shop key gets nothing. Replacing the
            signing secret stops every old caller at once.
          </p>
        </div>
        <Switch
          checked={shop.export_enabled}
          onChange={(on) => void setOn(on)}
          label="Let this shop read its data back"
          disabled={busy || !isOwner || shop.status !== 'connected' || (!shop.export_enabled && !shop.stock_push_has_secret)}
        />
      </div>

      {!shop.stock_push_has_secret && (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          This shop has no signing secret yet.{' '}
          <Link to={`/shops/${shop.id}/edit/general`} className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Create it on the General tab</Link>, then switch export on.
        </p>
      )}
      {!isOwner && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">Only the workspace owner can switch export on or off.</p>}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}

      {shop.export_enabled && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Address.</span>{' '}
            <code className="break-all font-mono">{functionsBaseUrl()}/export/orders</code> (also <code className="font-mono">customers</code> and{' '}
            <code className="font-mono">products</code>). {shop.export_last_used_at ? `Last used ${timeAgo(shop.export_last_used_at)}.` : 'Not used yet.'}
          </p>
          {canManage && (calls.data?.length ?? 0) > 0 && (
            <ul className="divide-y rounded-md border text-xs">
              {calls.data!.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                  <span>
                    <span className="font-medium">{c.resource}</span>{' '}
                    <span className="text-muted-foreground">
                      {c.status === 'ok' ? `${c.row_count ?? 0} rows` : c.status === 'started' ? 'unfinished' : c.reason ?? c.status}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    {c.status !== 'ok' && <Badge tone={c.status === 'started' ? undefined : 'danger'}>{c.status === 'refused' ? 'Refused' : c.status === 'failed' ? 'Failed' : 'Open'}</Badge>}
                    {timeAgo(c.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
