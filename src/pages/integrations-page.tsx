import { useQueryClient } from '@tanstack/react-query'
import { Plug, Plus, RotateCw, Ban } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { EventHistory } from '@/features/integrations/event-history'
import { KeyRevealModal } from '@/features/integrations/key-reveal'
import { PayloadTester } from '@/features/integrations/payload-tester'
import { useIntegrations } from '@/features/integrations/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime, timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Integration } from '@/types/db'

type Tab = 'connections' | 'events' | 'test'
const TABS: { id: Tab; label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'events', label: 'Event history' },
  { id: 'test', label: 'Test payload' },
]

export function IntegrationsPage() {
  const { current, canManage } = useWorkspace()
  const qc = useQueryClient()
  const integrations = useIntegrations()
  const [tab, setTab] = useState<Tab>('connections')
  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'rotate' | 'revoke'; target: Integration } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations', current.id] })

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim()
    if (!name) return setError('Give the connection a name.')
    setBusy(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc('create_integration', { org: current.id, integration_name: name })
    setBusy(false)
    if (rpcError) return setError(errorMessage(rpcError))
    setCreating(false)
    setSecret((data as { secret_key: string }[])[0].secret_key)
    void refresh()
  }

  async function runConfirmed() {
    if (!confirm) return
    setBusy(true)
    setError(null)
    if (confirm.kind === 'revoke') {
      const { error: rpcError } = await supabase.rpc('revoke_integration', { p_id: confirm.target.id })
      setBusy(false)
      if (rpcError) return setError(errorMessage(rpcError))
    } else {
      const { data, error: rpcError } = await supabase.rpc('rotate_integration_key', { p_id: confirm.target.id })
      setBusy(false)
      if (rpcError) return setError(errorMessage(rpcError))
      setSecret(data as string)
    }
    setConfirm(null)
    void refresh()
  }

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect a commerce store by giving it a WorkRelay secret key. Each key is bound to one store in this workspace only."
        actions={
          canManage && (
            <Button onClick={() => { setError(null); setCreating(true) }}>
              <Plus /> Connect store
            </Button>
          )
        }
      />

      <div role="tablist" className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {tab === 'connections' && (
          integrations.isLoading ? <TableSkeleton rows={3} /> :
          integrations.error ? <ErrorState onRetry={() => integrations.refetch()} /> :
          integrations.data!.length === 0 ? (
            <EmptyState
              icon={Plug}
              title="No stores connected"
              description="Create a connection to get a secret key, then paste it into your commerce app to start syncing orders."
              action={canManage ? <Button onClick={() => setCreating(true)}><Plus /> Connect store</Button> : undefined}
            />
          ) : (
            <Table>
              <THead>
                <tr><TH>Name</TH><TH>Status</TH><TH>Key</TH><TH>Store</TH><TH>Last seen</TH><TH><span className="sr-only">Actions</span></TH></tr>
              </THead>
              <tbody>
                {integrations.data!.map((i) => (
                  <TR key={i.id}>
                    <TD className="font-medium">{i.name}</TD>
                    <TD><StatusBadge status={i.status} /></TD>
                    <TD className="font-mono text-xs">{i.key_prefix}…</TD>
                    <TD className="text-muted-foreground">
                      {i.external_store_id ?? 'Waiting for the store to bind'}
                      {i.bound_at && <div className="text-xs">Bound {formatDateTime(i.bound_at)}</div>}
                    </TD>
                    <TD>{timeAgo(i.last_seen_at)}</TD>
                    <TD className="text-right">
                      {canManage && i.status !== 'revoked' && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => { setError(null); setConfirm({ kind: 'rotate', target: i }) }}>
                            <RotateCw /> Rotate
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => { setError(null); setConfirm({ kind: 'revoke', target: i }) }}>
                            <Ban /> Revoke
                          </Button>
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )
        )}
        {tab === 'events' && <EventHistory />}
        {tab === 'test' && (
          <>
            <CardHeader><CardTitle>Validate a sample event</CardTitle></CardHeader>
            <CardBody><PayloadTester /></CardBody>
          </>
        )}
      </Card>

      <Modal open={creating} onClose={() => setCreating(false)} title="Connect a store">
        <form onSubmit={create} className="space-y-4">
          <Field label="Connection name" hint="For example, the store's name." error={error}>
            {(id) => <Input id={id} name="name" maxLength={120} required autoFocus />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Generate key'}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.kind === 'revoke' ? 'Revoke this connection?' : 'Rotate the secret key?'}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {confirm?.kind === 'revoke'
              ? `"${confirm?.target.name}" will stop being accepted immediately. This cannot be undone; create a new connection to reconnect.`
              : `The current key for "${confirm?.target.name}" stops working immediately. The store keeps its binding, but you must paste the new key into the commerce app.`}
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant={confirm?.kind === 'revoke' ? 'destructive' : 'default'} disabled={busy} onClick={runConfirmed}>
              {confirm?.kind === 'revoke' ? 'Revoke' : 'Rotate key'}
            </Button>
          </div>
        </div>
      </Modal>

      <KeyRevealModal secret={secret} onClose={() => setSecret(null)} />
    </>
  )
}
