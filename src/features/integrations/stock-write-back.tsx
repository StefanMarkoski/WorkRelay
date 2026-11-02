import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'
import { useIntegrations } from './queries'
import { refusalText } from './sync'

/**
 * Stock write-back for one shop: WorkRelay sends the shop its stock number after an order, a cancellation or a return changes the
 * estimate. Every rule is enforced by the database; this panel only walks the owner through it in order: address, signed test,
 * switch. Only the workspace owner can set it up or switch it on. Any member can switch it off.
 */
export function StockWriteBack({ shop: initial }: { shop: Integration }) {
  const { current, isOwner } = useWorkspace()
  const qc = useQueryClient()
  const shop = useIntegrations().data?.find((s) => s.id === initial.id) ?? initial
  // the address is the owner's alone: members only know whether one is saved
  const savedUrl = useQuery({
    queryKey: ['stock-push-url', shop.id, shop.stock_push_has_url],
    enabled: isOwner && shop.stock_push_has_url,
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('get_stock_push_url', { p_integration: shop.id })
      if (err) throw err
      return (data as string | null) ?? ''
    },
  })
  const saved = shop.stock_push_has_url ? savedUrl.data ?? '' : ''
  const [edited, setEdited] = useState<string | null>(null)
  const url = edited ?? saved
  const setUrl = (v: string) => setEdited(v)
  const [busy, setBusy] = useState<'url' | 'test' | 'switch' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations', current.id] })
  const addressChanged = url.trim() !== saved
  const ready = shop.estimate_stock && shop.stock_push_has_url && shop.stock_push_has_secret && !!shop.stock_push_verified_at && !shop.stock_push_locked

  async function run(kind: NonNullable<typeof busy>, fn: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : errorMessage(e))
    } finally {
      setBusy(null)
      void refresh()
    }
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error: err } = await supabase.rpc(name, args)
    if (err) throw new Error(errorMessage(err))
    return data
  }

  const saveAddress = () => run('url', async () => { await rpc('set_stock_push_url', { p_integration: shop.id, p_url: url }); setEdited(null); void qc.invalidateQueries({ queryKey: ['stock-push-url', shop.id] }); setTestResult(null) })
  const sendTest = () => run('test', async () => {
    setTestResult(null)
    const { data, error: err } = await supabase.functions.invoke('stock-push-test', { body: { integration_id: shop.id } })
    if (err) throw new Error(await refusalText(err))
    const r = data as { status: 'ok' | 'failed'; error?: string }
    setTestResult(r.status === 'ok' ? { ok: true, text: 'The shop answered correctly. Write-back can be switched on.' } : { ok: false, text: r.error ?? 'The shop did not answer correctly.' })
    void qc.invalidateQueries({ queryKey: ['stock-pushes'] })
  })
  const setAuthority = (on: boolean) => run('switch', async () => { await rpc('set_stock_authority', { p_integration: shop.id, p_on: on }); void qc.invalidateQueries({ queryKey: ['stock-pushes'] }); void qc.invalidateQueries({ queryKey: ['stock-push-status'] }) })
  const setEnabled = (on: boolean) => run('switch', async () => { await rpc('set_stock_push_enabled', { p_integration: shop.id, p_enabled: on }); void qc.invalidateQueries({ queryKey: ['stock-pushes'] }) })

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            Send stock numbers to this shop{' '}
            {shop.stock_push_enabled ? <Badge tone="success">On</Badge> : shop.stock_push_locked ? <Badge tone="danger">Blocked</Badge> : <Badge>Off</Badge>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Optional, and off until the workspace owner switches it on. When an order, a cancellation or a return changes WorkRelay&apos;s estimate for a
            product, WorkRelay sends your shop the new number for that product: the SKU and the number, nothing else, signed with a secret only your
            shop and WorkRelay know. Like git, it reads the shop&apos;s own numbers first (quietly, from the product feed address above)
            and again after sending. If they disagree with what WorkRelay believed, nothing is overwritten and the owner decides which number stays.
          </p>
        </div>
        <Switch
          checked={shop.stock_push_enabled}
          onChange={(on) => void setEnabled(on)}
          label="Send stock numbers to this shop"
          disabled={busy !== null || (shop.stock_push_enabled ? false : !isOwner || !ready)}
        />
      </div>

      {shop.stock_push_paused_reason && !shop.stock_push_enabled && (
        <p role="status" className="mt-3 border-t pt-3 text-xs text-foreground">{shop.stock_push_paused_reason}</p>
      )}
      {shop.stock_push_locked && (
        <p role="status" className="mt-3 border-t pt-3 text-xs text-foreground">WorkRelay has blocked stock write-back for this shop. Contact WorkRelay to have it lifted.</p>
      )}

      {!shop.estimate_stock ? (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          Switch on <span className="font-medium text-foreground">Estimate stock between syncs</span> and save first: the estimate is the number that gets sent.
        </p>
      ) : !isOwner ? (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          {shop.stock_push_enabled ? 'You can switch this off at any time. ' : ''}Only the workspace owner can set it up or switch it on.
          {shop.stock_push_verified_at ? ` The shop last passed its test ${timeAgo(shop.stock_push_verified_at)}.` : ''}
        </p>
      ) : (
        <div className="mt-3 space-y-4 border-t pt-3">
          <Field
            label="The shop's stock address"
            hint="A public https address on your shop that accepts WorkRelay's signed requests. Changing it switches write-back off until the shop passes a new test."
          >
            {(id) => (
              <div className="flex gap-2">
                <Input
                  id={id}
                  value={url}
                  inputMode="url"
                  placeholder="https://shop.example.com/workrelay/stock"
                  maxLength={2000}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (addressChanged) void saveAddress() } }}
                />
                <Button type="button" variant="outline" disabled={busy !== null || !addressChanged} onClick={() => void saveAddress()}>
                  {busy === 'url' ? 'Saving…' : 'Save address'}
                </Button>
              </div>
            )}
          </Field>

          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Signing secret.</span>{' '}
            {shop.stock_push_has_secret ? (
              <>The shop&apos;s one signing secret is used. Replacing it (on the <Link to={`/shops/${shop.id}/edit/general`} className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">General tab</Link>) switches write-back off until the shop passes a new test.</>
            ) : (
              <>Not created yet. <Link to={`/shops/${shop.id}/edit/general`} className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Create the shop&apos;s signing secret on the General tab</Link>; your shop uses it to check that a request really came from WorkRelay.</>
            )}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              <span className="font-medium text-foreground">Test.</span>{' '}
              {testResult ? testResult.text
                : shop.stock_push_verified_at ? `The shop passed its test ${timeAgo(shop.stock_push_verified_at)}.`
                : 'WorkRelay sends one signed request with a random code. The shop passes by answering with the same code.'}
            </p>
            <Button type="button" variant="outline" disabled={busy !== null || !shop.stock_push_has_url || !shop.stock_push_has_secret || addressChanged} onClick={() => void sendTest()}>
              {busy === 'test' ? 'Sending…' : 'Send test'}
            </Button>
          </div>
          {testResult && !testResult.ok && <p role="alert" className="text-xs text-destructive">{testResult.text}</p>}

          <div className="flex items-start justify-between gap-4 border-t pt-3">
            <div>
              <p className="text-sm font-medium">WorkRelay keeps the stock</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                For a shop that does not count its own stock. The shop&apos;s number is still read and shown in Sync history, but it never replaces WorkRelay&apos;s,
                and a difference is not a disagreement. Orders and returns move WorkRelay&apos;s count, you set it by hand on the product (a delivery, a
                correction), and every change is sent to the shop. Leave it off if your shop counts its own stock: then a difference is held and you decide.
              </p>
            </div>
            <Switch checked={shop.stock_authority} onChange={(on) => void setAuthority(on)} label="WorkRelay keeps the stock" disabled={busy !== null} />
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}
      <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
        <Link to="/inventory/pushes" className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">See what was sent</Link>
        {' '}and decide any disagreements. Both directions are in <Link to="/inventory/syncs" className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Sync history</Link>.
      </p>

    </div>
  )
}
