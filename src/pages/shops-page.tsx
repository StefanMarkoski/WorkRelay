import { useQueryClient } from '@tanstack/react-query'
import { Plug, Plus, Settings2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Segmented } from '@/components/ui/segmented'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { CurrencySelect } from '@/components/common/currency-select'
import { EventHistory } from '@/features/integrations/event-history'
import { KeyRevealModal } from '@/features/integrations/key-reveal'
import { useIntegrations } from '@/features/integrations/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { currencyLabel } from '@/lib/currencies'
import { timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'

type Tab = 'shops' | 'events'
const TABS: { id: Tab; label: string }[] = [
  { id: 'shops', label: 'Shops' },
  { id: 'events', label: 'Event history' },
]

/** Every shop in the workspace. Opening one goes to its own page, where all of its setup lives. */
export function ShopsPage() {
  const { current, canManage } = useWorkspace()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const shops = useIntegrations({ poll: true })
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'events' ? 'events' : 'shops'
  const setTab = (t: Tab) => setParams(t === 'events' ? { tab: 'events' } : {}, { replace: true })
  const [creating, setCreating] = useState(false)
  const [newCurrency, setNewCurrency] = useState('')
  const [secret, setSecret] = useState<{ key: string; id: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
    if (!name) return setError('Give the connection a name.')
    if (!newCurrency) return setError('Choose the currency this shop sells in.')
    setBusy(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('create_integration', { org: current.id, integration_name: name, p_currency: newCurrency })
    setBusy(false)
    if (rpcError) return setError(errorMessage(rpcError))
    const row = (data as { integration_id: string; secret_key: string }[])[0]
    setCreating(false)
    setNewCurrency('')
    setSecret({ key: row.secret_key, id: row.integration_id })
    void qc.invalidateQueries({ queryKey: ['integrations', current.id] })
  }

  // after the key is copied, go straight to the new shop's setup
  const closeKey = () => {
    const id = secret?.id
    setSecret(null)
    if (id) navigate(`/shops/${id}/edit/general`)
  }

  return (
    <>
      <PageHeader
        title="Shops"
        description="Connect a shop by giving it a WorkRelay secret key. Each key is bound to one shop in this workspace only. Open a shop to set up its orders, customers and inventory."
        actions={canManage && <Button onClick={() => { setError(null); setCreating(true) }}><Plus /> Connect shop</Button>}
      />

      <Segmented className="mb-4" label="Shops sections" value={tab} onChange={setTab} options={TABS} />

      <Card>
        {tab === 'shops' && (
          shops.isLoading ? <TableSkeleton rows={3} /> :
          shops.error ? <ErrorState onRetry={() => shops.refetch()} /> :
          shops.data!.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No shops connected"
              description="Create a connection to get a secret key, then paste it into your shop to start syncing orders."
              action={canManage ? <Button onClick={() => setCreating(true)}><Plus /> Connect shop</Button> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <tr><TH>Name</TH><TH>Currency</TH><TH>Status</TH><TH>Store</TH><TH>Last seen</TH><TH><span className="sr-only">Open</span></TH></tr>
              </THead>
              <tbody>
                {shops.data!.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-medium">
                      {i.status === 'revoked' ? i.name : (
                        <Link to={`/shops/${i.id}/edit/general`} className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">{i.name}</Link>
                      )}
                      {i.track_signups && <div className="mt-0.5 text-[11px] font-normal text-muted-foreground">Customer signups on</div>}
                    </TD>
                    <TD>
                      {i.currency ? (
                        <span className="font-medium" title={currencyLabel(i.currency)}>{i.currency}</span>
                      ) : i.status === 'revoked' ? '—' : (
                        <Badge tone="warning" title="Orders cannot be tied to a currency until one is set">Not set</Badge>
                      )}
                    </TD>
                    <TD><StatusBadge status={i.status} /></TD>
                    <TD className="text-muted-foreground">{i.external_store_id ?? 'Waiting for the shop to bind'}</TD>
                    <TD>{timeAgo(i.last_seen_at)}</TD>
                    <TD className="text-right">
                      {i.status !== 'revoked' && (
                        <Link to={`/shops/${i.id}/edit/general`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}><Settings2 /> Set up</Link>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )
        )}
        {tab === 'events' && <EventHistory />}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Connect a shop">
        <form onSubmit={create} className="space-y-4">
          <Field label="Connection name" hint="For example, the shop's name." error={error}>
            {(id) => <Input id={id} name="name" maxLength={120} required autoFocus />}
          </Field>
          <Field label="Currency" hint="Every order from this shop is in this currency, and amounts are never converted. You can change it later on the shop's page.">
            {(id) => <CurrencySelect id={id} value={newCurrency} onChange={setNewCurrency} placeholder="Choose a currency…" required />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Generate key'}</Button>
          </div>
        </form>
      </Modal>

      <KeyRevealModal secret={secret?.key ?? null} onClose={closeKey} />
    </>
  )
}
