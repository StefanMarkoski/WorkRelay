import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { functionsBaseUrl, useSignupAutomations } from '@/features/integrations/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'

const SAMPLE = `{
  "event_id": "cust_77:created",
  "event_type": "customer.created",
  "occurred_at": "2026-10-27T09:15:00Z",
  "customer": { "email": "ana@example.com", "name": "Ana Petrova" }
}`

interface LastSignupEvent { status: string; error: string | null; received_at: string }

/** The optional signup webhook: switch it on, see the address and a sample, and whether the shop has sent anything. */
export function CustomersTab({ shop }: { shop: Integration }) {
  const { current, canManage } = useWorkspace()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [askOff, setAskOff] = useState(false)
  const dependents = useSignupAutomations(shop.id)
  const last = useQuery({
    queryKey: ['signup-health', shop.id],
    refetchInterval: 5_000,
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('webhook_events')
        .select('status, error, received_at')
        .eq('integration_id', shop.id)
        .like('event_type', 'customer.%')
        .order('received_at', { ascending: false })
        .limit(1)
      if (err) throw err
      return ((data ?? []) as LastSignupEvent[])[0] ?? null
    },
  })

  async function set(on: boolean) {
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('set_integration_signups', { p_id: shop.id, p_enabled: on })
    setBusy(false)
    if (rpcError) return setError(errorMessage(rpcError))
    setAskOff(false)
    void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
    void qc.invalidateQueries({ queryKey: ['automations'] })
    void qc.invalidateQueries({ queryKey: ['signup-automations'] })
  }
  // switching off pauses the automations that wait for signups, so say so before it happens
  const toggle = (on: boolean) => (!on && (dependents.data ?? 0) > 0 ? setAskOff(true) : void set(on))

  const lastEvent = last.data
  const ignoredWhileOff = lastEvent?.status === 'ignored' && String(lastEvent.error ?? '').startsWith('signups_off')
  const n = dependents.data ?? 0

  return (
    <section aria-labelledby="signups-title" className="max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="signups-title" className="font-display text-lg font-semibold tracking-[-0.01em]">Receive customer signups</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Optional. Lets this shop tell WorkRelay when a customer creates an account, even before their first order. Orders already create
            customers without it.
          </p>
        </div>
        <Switch checked={shop.track_signups} onChange={toggle} label="Receive customer signups" disabled={!canManage || busy} />
      </div>

      {askOff && (
        <div role="status" className="mt-4 rounded-lg border p-3 text-sm">
          <p>
            {n} automation{n === 1 ? '' : 's'} cover{n === 1 ? 's' : ''} signups from this shop. If you switch this off, {n === 1 ? 'it stops' : 'they stop'} receiving
            from this shop. {n === 1 ? 'It keeps' : 'They keep'} running for any other shop that sends signups, and wait if none does. Signups
            sent while this is off are not replayed.
          </p>
          <div className="mt-3 flex gap-2">
            <Button variant="destructive" disabled={busy} onClick={() => void set(false)}>Switch off</Button>
            <Button variant="ghost" onClick={() => setAskOff(false)}>Keep it on</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

      {shop.track_signups && (
        <div className="mt-4 space-y-3 border-t pt-4 text-sm">
          <p className="text-muted-foreground">
            Send <span className="font-mono text-foreground [overflow-wrap:anywhere]">POST {functionsBaseUrl()}/customer-webhook</span> with the same key and{' '}
            <span className="font-mono text-foreground">X-Store-Id</span> as for orders. There is nothing to bind again.
          </p>
          <pre className="housing overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-white/85">{SAMPLE}</pre>
          <p className="text-xs text-muted-foreground">
            {last.isLoading ? 'Checking for signup events…'
              : !lastEvent ? 'No signup events received yet.'
              : ignoredWhileOff ? `The last signup event (${timeAgo(lastEvent.received_at)}) was ignored because this was off. Have the shop resend it.`
              : `Last signup event: ${lastEvent.status}, ${timeAgo(lastEvent.received_at)}.`}
          </p>
        </div>
      )}
    </section>
  )
}
