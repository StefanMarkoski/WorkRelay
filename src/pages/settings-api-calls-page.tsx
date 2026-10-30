import { useQueryClient } from '@tanstack/react-query'
import { Plug } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { useIntegrations } from '@/features/integrations/queries'
import { useIntegrationSyncs } from '@/features/integrations/sync'
import { lastSynced } from '@/features/integrations/sync-freshness'
import { SyncNowControl } from '@/features/integrations/sync-now-button'
import { shopLabel } from '@/features/integrations/shop-label'
import { ApiCallsKinds, SettingsTabs } from '@/features/settings/settings-tabs'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, formatSyncPace, timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration, IntegrationSync } from '@/types/db'

export function SettingsApiCallsPage() {
  const integrations = useIntegrations()
  const syncs = useIntegrationSyncs()
  const shops = (integrations.data ?? []).filter((i) => i.status !== 'revoked')

  return (
    <>
      <PageHeader title="Settings" description="Workspace details and who can access them." />
      <SettingsTabs />
      <ApiCallsKinds />
      <div className="mb-5 max-w-3xl">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">Inventory API calls</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          How WorkRelay keeps each shop's products and stock up to date. It can ask the shop for them on a schedule, and the shop can also send them
          to WorkRelay. You say where to ask; how often, and whether the shop may send, is set by WorkRelay for your plan.
        </p>
      </div>
      {integrations.isLoading || syncs.isLoading ? (
        <TableSkeleton rows={3} />
      ) : integrations.error || syncs.error ? (
        <ErrorState onRetry={() => { void integrations.refetch(); void syncs.refetch() }} />
      ) : shops.length === 0 ? (
        <Card><EmptyState icon={Plug} title="No shops connected" description="Connect a shop under Integrations first, then set up its product feed here." /></Card>
      ) : (
        <div className="space-y-4">
          {shops.map((shop) => (
            <ShopCalls key={shop.id} shop={shop} sync={(syncs.data ?? []).find((s) => s.integration_id === shop.id) ?? null} />
          ))}
        </div>
      )}
    </>
  )
}

function ShopCalls({ shop, sync }: { shop: Integration; sync: IntegrationSync | null }) {
  const { canManage } = useWorkspace()
  const qc = useQueryClient()
  const [url, setUrl] = useState(sync?.source_url ?? '')
  const [header, setHeader] = useState('')
  const [clearHeader, setClearHeader] = useState(false)
  const [paused, setPaused] = useState(sync?.paused ?? false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const hasRate = sync?.calls != null && sync.days != null
  const fresh = lastSynced(sync)
  const dirty =
    url.trim() !== (sync?.source_url ?? '') || header !== '' || clearHeader || paused !== (sync?.paused ?? false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.rpc('set_sync_source', {
      p_integration: shop.id,
      p_url: url.trim(),
      // null keeps the stored value (it can never be read back); an empty string removes it.
      p_auth_header: clearHeader ? '' : header.trim() === '' ? null : header.trim(),
      p_paused: paused,
    })
    setBusy(false)
    if (error) return setMessage({ tone: 'error', text: errorMessage(error) })
    setHeader('')
    setClearHeader(false)
    setMessage({ tone: 'ok', text: 'Saved.' })
    void qc.invalidateQueries({ queryKey: ['integration-sync'] })
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{shopLabel(shop)}</CardTitle>
        {hasRate ? (
          <Badge tone={paused ? 'neutral' : sync?.last_error ? 'danger' : 'success'}>
            {paused ? 'Paused' : sync?.last_error ? 'Last check failed' : 'Scheduled'}
          </Badge>
        ) : (
          <Badge>Not scheduled</Badge>
        )}
      </CardHeader>
      <CardBody>
        <dl className="mb-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">Calls</dt>
            <dd className="mt-0.5 font-medium">
              {hasRate ? `${sync!.calls!.toLocaleString()} per ${sync!.days === 1 ? 'day' : `${sync!.days} days`}` : 'Not set'}
            </dd>
            <dd className="text-xs text-muted-foreground">{hasRate ? formatSyncPace(sync!.calls, sync!.days) : 'Set by WorkRelay'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last synced</dt>
            <dd className="mt-0.5 font-medium" title={fresh.at ? formatDateTime(fresh.at) : undefined}>{fresh.at ? timeAgo(fresh.at) : 'Never'}</dd>
            {fresh.how && <dd className="text-xs text-muted-foreground">{fresh.how === 'push' ? `Sent by ${fresh.by ?? 'the shop'}` : 'Checked by WorkRelay'}</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Next check</dt>
            <dd className="mt-0.5 font-medium">{hasRate && !paused && sync?.source_url ? formatDateTime(sync?.next_sync_at) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Quick sync from your shop</dt>
            <dd className="mt-0.5 font-medium">{sync?.push_enabled ? 'Allowed' : 'Not allowed'}</dd>
            <dd className="text-xs text-muted-foreground">{sync?.push_enabled ? 'Your shop can send stock to WorkRelay at any time' : 'Set by WorkRelay'}</dd>
          </div>
        </dl>
        {sync?.last_error && (
          <p role="status" className="mb-4 rounded-lg border border-destructive/40 px-3 py-2 text-sm text-destructive">
            The last check failed: {sync.last_error}
          </p>
        )}
        <SyncNowControl shopId={shop.id} className="mb-4" />
        {!hasRate && (
          <p className="mb-4 text-sm text-muted-foreground">
            No schedule is set for this shop, so WorkRelay will not call it. Ask WorkRelay to set how many calls per how many days this shop gets.
            Quick sync from your shop, once WorkRelay allows it, works without a schedule.
          </p>
        )}

        <form onSubmit={save} className="space-y-3 border-t pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Products URL" hint="An https address that answers with your products. See the integration guide for the format.">
              {(id) => (
                <Input id={id} type="url" inputMode="url" placeholder="https://yourshop.com/workrelay/products" maxLength={2000} disabled={!canManage || busy} value={url} onChange={(e) => setUrl(e.target.value)} />
              )}
            </Field>
            <div>
              <Field
                label="Authorization (optional)"
                hint={sync?.has_auth_header && !clearHeader ? 'One is saved and is never shown again. Type a new value to replace it.' : 'Leave empty if your products endpoint needs no token.'}
              >
                {(id) => (
                  <div className="flex items-center gap-2">
                    <Input
                      id={id}
                      type="password"
                      autoComplete="off"
                      maxLength={2000}
                      disabled={!canManage || busy || clearHeader}
                      placeholder={sync?.has_auth_header ? '••••••••' : 'e.g. Bearer 9f3a7c1d2b8e'}
                      value={header}
                      onChange={(e) => setHeader(e.target.value)}
                    />
                    {canManage && sync?.has_auth_header && (
                      <button type="button" className="text-xs whitespace-nowrap text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => { setClearHeader(!clearHeader); setHeader('') }}>
                        {clearHeader ? 'Keep it' : 'Remove'}
                      </button>
                    )}
                  </div>
                )}
              </Field>
              <div className="mt-2 space-y-1 rounded-md border bg-card p-2.5 text-[11px] text-muted-foreground">
                <p>
                  Example, type only the value:{' '}
                  <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">Bearer 9f3a7c1d2b8e</code>
                </p>
                <p>WorkRelay sends it to your products URL as this header:</p>
                <code className="block rounded bg-secondary px-2 py-1 font-mono text-foreground [overflow-wrap:anywhere]">Authorization: Bearer 9f3a7c1d2b8e</code>
                <p>Use the whole value your endpoint expects, including the word Bearer if it needs one.</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Switch label={`Pause checks for ${shop.name}`} checked={paused} onChange={setPaused} disabled={!canManage || busy} />
              Pause scheduled checks
            </label>
          </div>
          {canManage ? (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save'}</Button>
              {message && <span role={message.tone === 'error' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'error' ? 'text-destructive' : 'text-success'}`}>{message.text}</span>}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Only owners and admins can change this.</p>
          )}
        </form>
      </CardBody>
    </Card>
  )
}

