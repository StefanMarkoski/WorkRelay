import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '@/components/common/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
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
 * creates an export secret, and clearing the secret switches it off at once. Every rule is enforced by the database and the export
 * function; this panel only lets the owner switch it on or off and shows the recent calls.
 */
export function ExportAccess({ shop: initial }: { shop: Integration }) {
  const { current, isOwner, canManage } = useWorkspace()
  const qc = useQueryClient()
  const shop = useIntegrations().data?.find((s) => s.id === initial.id) ?? initial
  const [busy, setBusy] = useState<'secret' | 'off' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const canSee = canManage

  const calls = useQuery({
    queryKey: ['export-calls', shop.id, shop.export_has_secret],
    enabled: canSee,
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

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : errorMessage(e))
    } finally {
      setBusy(null)
      void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
      void qc.invalidateQueries({ queryKey: ['export-calls', shop.id] })
    }
  }
  const call = async (name: string) => {
    const { data, error: err } = await supabase.rpc(name, { p_integration: shop.id })
    if (err) throw new Error(errorMessage(err))
    return data
  }
  const makeSecret = () => run('secret', async () => setSecret((await call('rotate_export_secret')) as string))
  const switchOff = () => run('off', async () => { await call('clear_export_secret') })

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            Let this shop read its data back{' '}
            {shop.export_has_secret ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Optional, read-only, and off until the workspace owner creates an export secret. With it, your shop (or a script you run) can fetch this
            shop&apos;s orders, customers and products, a page at a time. A call needs three things at once: this shop&apos;s key, a request signed with
            the export secret, and a number of calls left this hour (120). Anyone with only the shop key gets nothing. Replacing or removing the secret
            stops every old caller at once.
          </p>
        </div>
        {isOwner && (
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" disabled={busy !== null || shop.status !== 'connected'} onClick={() => void makeSecret()}>
              <KeyRound aria-hidden /> {busy === 'secret' ? 'Creating…' : shop.export_has_secret ? 'Replace secret' : 'Create secret'}
            </Button>
            {shop.export_has_secret && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void switchOff()}>
                {busy === 'off' ? 'Switching off…' : 'Switch off'}
              </Button>
            )}
          </div>
        )}
      </div>

      {shop.export_has_secret && (
        <div className="mt-3 space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Address.</span>{' '}
            <code className="break-all font-mono">{functionsBaseUrl()}/export/orders</code> (also <code className="font-mono">customers</code> and{' '}
            <code className="font-mono">products</code>). {shop.export_last_used_at ? `Last used ${timeAgo(shop.export_last_used_at)}.` : 'Not used yet.'}
          </p>
          {canSee && (calls.data?.length ?? 0) > 0 && (
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
      {!isOwner && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">Only the workspace owner can switch export on or off.</p>}
      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}

      <Modal open={secret !== null} onClose={() => setSecret(null)} title="Your export secret">
        {secret && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border bg-muted p-3">
              <div className="flex items-center gap-2">
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <code className="break-all font-mono text-xs">{secret}</code>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Copy this now. It is shown only once; WorkRelay keeps the only other copy in its vault, and it cannot be read back. Keep it out of your shop&apos;s
              pages and out of any repository: it is what lets a caller sign requests. The integration guide shows how to sign one.
            </p>
            <div className="flex justify-end gap-2">
              <CopyButton text={secret} label="Copy secret" />
              <Button type="button" onClick={() => setSecret(null)}>I have saved it</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
