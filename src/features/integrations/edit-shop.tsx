import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { CurrencySelect } from '@/components/common/currency-select'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Switch } from '@/components/ui/switch'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'
import { functionsBaseUrl, useSignupAutomations } from './queries'

const SAMPLE = `{
  "event_id": "cust_77:created",
  "event_type": "customer.created",
  "occurred_at": "2026-10-27T09:15:00Z",
  "customer": { "email": "ana@example.com", "name": "Ana Petrova" }
}`

interface LastSignupEvent { status: string; error: string | null; received_at: string }

/** Rename a shop and switch on its optional customer-signup webhook. Owners and admins only (the database checks too). */
export function EditShop({ shop, onClose }: { shop: Integration | null; onClose: () => void }) {
  return (
    <Modal open={shop !== null} onClose={onClose} title={shop ? `Edit ${shop.name}` : 'Edit shop'}>
      {shop && <EditShopForm key={shop.id} shop={shop} onClose={onClose} />}
    </Modal>
  )
}

function EditShopForm({ shop, onClose }: { shop: Integration; onClose: () => void }) {
  const { current } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState(shop.name)
  const [signups, setSignups] = useState(shop.track_signups)
  const [currency, setCurrency] = useState(shop.currency ?? '')
  const [estimate, setEstimate] = useState(shop.estimate_stock)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // What the shop has sent to the signup endpoint: tells "switched on, nothing sent yet" apart from "working".
  const last = useQuery({
    queryKey: ['signup-health', shop.id],
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('webhook_events')
        .select('status, error, received_at')
        .eq('integration_id', shop.id)
        .like('event_type', 'customer.%')
        .order('received_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return ((data ?? []) as LastSignupEvent[])[0] ?? null
    },
  })

  // Automations that wait for signups: switching off pauses them, so say so before it happens.
  const dependents = useSignupAutomations(shop.id)

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Give the connection a name.')
    setBusy(true)
    setError(null)
    if (trimmed !== shop.name) {
      const { error: nameError } = await supabase.from('integrations').update({ name: trimmed }).eq('id', shop.id)
      if (nameError) { setBusy(false); return setError(errorMessage(nameError)) }
    }
    if (currency && currency !== shop.currency) {
      const { error: rpcError } = await supabase.rpc('set_integration_currency', { p_id: shop.id, p_currency: currency })
      if (rpcError) { setBusy(false); return setError(errorMessage(rpcError)) }
    }
    if (signups !== shop.track_signups) {
      const { error: rpcError } = await supabase.rpc('set_integration_signups', { p_id: shop.id, p_enabled: signups })
      if (rpcError) { setBusy(false); return setError(errorMessage(rpcError)) }
    }
    if (estimate !== shop.estimate_stock) {
      const { error: rpcError } = await supabase.rpc('set_integration_estimate_stock', { p_id: shop.id, p_enabled: estimate })
      if (rpcError) { setBusy(false); return setError(errorMessage(rpcError)) }
    }
    setBusy(false)
    void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
    void qc.invalidateQueries({ queryKey: ['automations'] })
    void qc.invalidateQueries({ queryKey: ['insights'] })
    void qc.invalidateQueries({ queryKey: ['orders'] })
    void qc.invalidateQueries({ queryKey: ['stock-estimates'] })
    void qc.invalidateQueries({ queryKey: ['signup-automations'] })
    onClose()
  }

  const lastEvent = last.data
  const ignoredWhileOff = lastEvent?.status === 'ignored' && String(lastEvent.error ?? '').startsWith('signups_off')

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Connection name" error={error}>
        {(id) => <Input id={id} value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} />}
      </Field>

      <Field
        label="Currency"
        hint={
          shop.currency && currency !== shop.currency
            ? `Orders from ${shop.name} stay exactly as they are, and no amount is converted. Orders that already say a different currency are marked, and orders with none take ${currency || 'the new one'}.`
            : 'The one currency this shop sells in. Orders that arrive without a currency are given it, and amounts are never converted.'
        }
      >
        {(id) => <CurrencySelect id={id} value={currency} onChange={setCurrency} placeholder={shop.currency ? undefined : 'Choose a currency…'} />}
      </Field>

      <div className="rounded-lg border p-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Receive customer signups</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Optional. Lets this shop tell WorkRelay when a customer creates an account, even before their first order.
              Orders already create customers without it.
            </p>
          </div>
          <Switch checked={signups} onChange={setSignups} label="Receive customer signups" />
        </div>

        {signups && (
          <div className="mt-3 space-y-3 border-t pt-3 text-xs">
            <p className="text-muted-foreground">
              Send <span className="font-mono text-foreground [overflow-wrap:anywhere]">POST {functionsBaseUrl()}/customer-webhook</span> with the same key and{' '}
              <span className="font-mono text-foreground">X-Store-Id</span> as for orders. There is nothing to bind again.
            </p>
            <pre className="housing overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-white/85">{SAMPLE}</pre>
            <p className="text-muted-foreground">
              {last.isLoading ? 'Checking for signup events…'
                : !lastEvent ? 'No signup events received yet.'
                : ignoredWhileOff ? `The last signup event (${timeAgo(lastEvent.received_at)}) was ignored because this was off. Save this switch on, then have the shop resend it.`
                : `Last signup event: ${lastEvent.status}, ${timeAgo(lastEvent.received_at)}.`}
            </p>
          </div>
        )}

        {!signups && shop.track_signups && (dependents.data ?? 0) > 0 && (
          <p role="status" className="mt-3 border-t pt-3 text-xs">
            {dependents.data} automation{dependents.data === 1 ? '' : 's'} cover{dependents.data === 1 ? 's' : ''} signups from this shop. After you
            save, {dependents.data === 1 ? 'it stops' : 'they stop'} receiving from this shop. {dependents.data === 1 ? 'It keeps' : 'They keep'} running
            for any other shop that sends signups, and wait if none does. Signups sent while this is off are not replayed.
          </p>
        )}
      </div>

      <div className="rounded-lg border p-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Estimate stock between syncs</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Optional. Next to the stock your shop reports, WorkRelay shows an estimate: the last reported number minus the pieces ordered since.
              Your shop stays the source of truth, and every new sync replaces the estimate. Cancelled orders are not counted.
            </p>
          </div>
          <Switch checked={estimate} onChange={setEstimate} label="Estimate stock between syncs" />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}
