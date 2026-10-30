import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Switch } from '@/components/ui/switch'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'
import { functionsBaseUrl } from './queries'

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
  const dependents = useQuery({
    queryKey: ['signup-automations', current.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('workflows').select('id, enabled, preset_config').eq('organization_id', current.id).eq('enabled', true)
      if (error) throw error
      return ((data ?? []) as { id: string; preset_config: { event?: string; integration_id?: string } | null }[]).filter(
        (w) => w.preset_config?.event === 'customer_signed_up' && (!w.preset_config.integration_id || w.preset_config.integration_id === shop.id),
      ).length
    },
  })

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
    if (signups !== shop.track_signups) {
      const { error: rpcError } = await supabase.rpc('set_integration_signups', { p_id: shop.id, p_enabled: signups })
      if (rpcError) { setBusy(false); return setError(errorMessage(rpcError)) }
    }
    setBusy(false)
    void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
    void qc.invalidateQueries({ queryKey: ['automations'] })
    onClose()
  }

  const lastEvent = last.data
  const ignoredWhileOff = lastEvent?.status === 'ignored' && String(lastEvent.error ?? '').startsWith('signups_off')

  return (
    <form onSubmit={save} className="space-y-4">
      <Field label="Connection name" error={error}>
        {(id) => <Input id={id} value={name} maxLength={120} required autoFocus onChange={(e) => setName(e.target.value)} />}
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
            {dependents.data} automation{dependents.data === 1 ? '' : 's'} wait{dependents.data === 1 ? 's' : ''} for signups from this shop. They stay saved
            and show as waiting until you switch this back on. Signups sent while it is off are not replayed.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </form>
  )
}
