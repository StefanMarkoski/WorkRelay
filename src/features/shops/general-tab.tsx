import { useQueryClient } from '@tanstack/react-query'
import { Ban, RotateCw } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { CurrencySelect } from '@/components/common/currency-select'
import { StatusBadge } from '@/components/common/status-badge'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { KeyRevealModal } from '@/features/integrations/key-reveal'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'

/** The shop's name and currency, and the facts and actions of its key. */
export function GeneralTab({ shop }: { shop: Integration }) {
  const { current, canManage } = useWorkspace()
  const qc = useQueryClient()
  const [name, setName] = useState(shop.name)
  const [currency, setCurrency] = useState(shop.currency ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
    void qc.invalidateQueries({ queryKey: ['insights'] })
    void qc.invalidateQueries({ queryKey: ['orders'] })
  }
  const dirty = name.trim() !== shop.name || (currency !== '' && currency !== (shop.currency ?? ''))

  async function save(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Give the connection a name.')
    setBusy(true)
    setError(null)
    setSaved(false)
    if (trimmed !== shop.name) {
      const { error: nameError } = await supabase.from('integrations').update({ name: trimmed }).eq('id', shop.id)
      if (nameError) { setBusy(false); return setError(errorMessage(nameError)) }
    }
    if (currency && currency !== shop.currency) {
      const { error: rpcError } = await supabase.rpc('set_integration_currency', { p_id: shop.id, p_currency: currency })
      if (rpcError) { setBusy(false); return setError(errorMessage(rpcError)) }
    }
    setBusy(false)
    setSaved(true)
    refresh()
  }

  async function runConfirmed() {
    if (!confirm) return
    setBusy(true)
    setError(null)
    if (confirm === 'revoke') {
      const { error: rpcError } = await supabase.rpc('revoke_integration', { p_id: shop.id })
      setBusy(false)
      if (rpcError) return setError(errorMessage(rpcError))
    } else {
      const { data, error: rpcError } = await supabase.rpc('rotate_integration_key', { p_id: shop.id })
      setBusy(false)
      if (rpcError) return setError(errorMessage(rpcError))
      setSecret(data as string)
    }
    setConfirm(null)
    refresh()
  }

  return (
    <div className="space-y-8">
      <form onSubmit={save} className="max-w-xl space-y-4">
        <Field label="Connection name" error={error && !confirm ? error : null}>
          {(id) => <Input id={id} value={name} maxLength={120} required disabled={!canManage} onChange={(e) => { setName(e.target.value); setSaved(false) }} />}
        </Field>
        <Field
          label="Currency"
          hint={
            shop.currency && currency !== shop.currency
              ? `Orders from ${shop.name} stay exactly as they are, and no amount is converted. Orders that already say a different currency are marked, and orders with none take ${currency || 'the new one'}.`
              : 'The one currency this shop sells in. Orders that arrive without a currency are given it, and amounts are never converted.'
          }
        >
          {(id) => <CurrencySelect id={id} value={currency} onChange={(v) => { setCurrency(v); setSaved(false) }} placeholder={shop.currency ? undefined : 'Choose a currency…'} disabled={!canManage} />}
        </Field>
        {canManage && (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy || !dirty}>{busy && !confirm ? 'Saving…' : 'Save'}</Button>
            {saved && <span role="status" className="text-sm text-success">Saved.</span>}
          </div>
        )}
      </form>

      <section aria-labelledby="key-title" className="max-w-3xl border-t pt-6">
        <h2 id="key-title" className="font-display text-lg font-semibold tracking-[-0.01em]">Connection and key</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-0.5"><StatusBadge status={shop.status} /></dd></div>
          <div><dt className="text-xs text-muted-foreground">Key</dt><dd className="mt-0.5 font-mono text-xs">{shop.key_prefix}…</dd></div>
          <div>
            <dt className="text-xs text-muted-foreground">Store id</dt>
            <dd className="mt-0.5 text-muted-foreground">{shop.external_store_id ?? 'Waiting for the store to bind'}</dd>
            {shop.bound_at && <dd className="text-xs text-muted-foreground">Bound {formatDateTime(shop.bound_at)}</dd>}
          </div>
          <div><dt className="text-xs text-muted-foreground">Last seen</dt><dd className="mt-0.5">{timeAgo(shop.last_seen_at)}</dd></div>
        </dl>
        {canManage && shop.status !== 'revoked' && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { setError(null); setConfirm('rotate') }}><RotateCw /> Rotate key</Button>
            <Button variant="outline" onClick={() => { setError(null); setConfirm('revoke') }}><Ban /> Revoke connection</Button>
          </div>
        )}
      </section>

      <Modal open={confirm !== null} onClose={() => setConfirm(null)} title={confirm === 'revoke' ? 'Revoke this connection?' : 'Rotate the secret key?'}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {confirm === 'revoke'
              ? `"${shop.name}" will stop being accepted immediately. This cannot be undone; create a new connection to reconnect.`
              : `The current key for "${shop.name}" stops working immediately. The store keeps its binding, but you must paste the new key into the commerce app.`}
          </p>
          {error && confirm && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm === 'revoke' ? 'destructive' : 'default'} disabled={busy} onClick={runConfirmed}>{confirm === 'revoke' ? 'Revoke' : 'Rotate key'}</Button>
          </div>
        </div>
      </Modal>
      <KeyRevealModal secret={secret} onClose={() => setSecret(null)} />
    </div>
  )
}
