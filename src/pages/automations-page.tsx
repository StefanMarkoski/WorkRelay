import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ClipboardCheck, Plus, Trash2, Zap } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { describePreset, shopIds, type PresetKind } from '@/domain/presets'
import { AUTOMATION_COLUMNS, deleteAutomation, saveAutomation, setAutomationEnabled, type AutomationRow } from '@/features/automations/api'
import { ShopPicker } from '@/features/automations/shop-picker'
import { duplicatesThatFire } from '@/features/automations/duplicates'
import { eligibleShops, normalizeSelection, reconcileSelection, shopLabel, shopStatus, type ShopSelection } from '@/features/automations/shops'
import { useIntegrations } from '@/features/integrations/queries'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { timeAgo } from '@/lib/format'
import { supabase } from '@/lib/supabase'

const KINDS: { kind: PresetKind; title: string; text: string; icon: typeof Bell }[] = [
  { kind: 'notify', title: 'Notifications', text: 'Post a message to Discord, Slack or any webhook when an order arrives, is cancelled or changes status, or when a new customer appears.', icon: Bell },
  { kind: 'review_large', title: 'Review large orders', text: 'Create an approval task for your team when an order is above an amount you choose.', icon: ClipboardCheck },
]

interface Editing {
  id?: string
  kind: PresetKind
  config: Record<string, string>
  /** null = all shops */
  shops: ShopSelection
}

export function AutomationsPage() {
  const { current, canManage } = useWorkspace()
  const qc = useQueryClient()
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const integrations = useIntegrations()
  const allShops = integrations.data ?? []
  const connectedShops = allShops.filter((i) => i.status === 'connected')
  // Shops that send signups. "A customer signs up" only works with at least one of them.
  const signupShops = eligibleShops(allShops, 'customer_signed_up')

  const query = useQuery({
    queryKey: ['automations', current.id],
    enabled: canManage,
    queryFn: async () => {
      const { data, error: e } = await supabase
        .from('workflows')
        .select(AUTOMATION_COLUMNS)
        .eq('organization_id', current.id)
        .is('deleted_at', null)
        // Preset automations, plus any custom workflow that was actually published. Unpublished leftovers are hidden.
        .or('preset.not.is.null,current_version_id.not.is.null')
        .order('created_at', { ascending: false })
      if (e) throw e
      return data as AutomationRow[]
    },
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['automations', current.id] })
    void qc.invalidateQueries({ queryKey: ['overview'] })
  }

  const [deleting, setDeleting] = useState<AutomationRow | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  async function confirmDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deleteAutomation(deleting.id)
      setDeleting(null)
      refresh()
      for (const key of ['overview', 'signup-automations']) void qc.invalidateQueries({ queryKey: [key] })
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete the automation.')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (!canManage) {
    return (
      <>
        <PageHeader title="Automations" />
        <ErrorState message="Only owners and administrators can manage automations." />
      </>
    )
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    setBusy(true)
    setError(null)
    const c = editing.config
    const selection = normalizeSelection(editing.shops, eligibleShops(allShops, editing.kind === 'notify' ? c.event : 'created'))
    const limit = selection ? { integration_ids: selection } : {}
    const config =
      editing.kind === 'notify'
        ? { event: c.event, channel: c.channel, url: (c.url ?? '').trim(), ...limit }
        : { threshold: Number(c.threshold), reviewer_role: c.reviewer_role, ...limit }
    try {
      await saveAutomation({ organizationId: current.id, id: editing.id, kind: editing.kind, config, enable: true })
      setEditing(null)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the automation.')
      refresh() // whatever the failure, the list must show what is actually stored
    } finally {
      setBusy(false)
    }
  }

  async function toggle(a: AutomationRow, enabled: boolean) {
    setError(null)
    try {
      await setAutomationEnabled(a.id, enabled)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the automation.')
    }
  }

  const start = (kind: PresetKind) => {
    setPicking(false)
    setError(null)
    setEditing({
      kind,
      config: kind === 'notify' ? { event: 'created', channel: 'discord', url: '' } : { threshold: '100', reviewer_role: 'admin' },
      shops: null,
    })
  }
  const set = (key: string) => (e: { target: { value: string } }) =>
    setEditing((cur) => (cur ? { ...cur, config: { ...cur.config, [key]: e.target.value } } : cur))
  // Changing the event can change which shops qualify (signups need the switch on), so the ticked shops are re-checked.
  const setEvent = (e: { target: { value: string } }) =>
    setEditing((cur) => (cur ? { ...cur, config: { ...cur.config, event: e.target.value }, shops: reconcileSelection(cur.shops, eligibleShops(allShops, e.target.value)) } : cur))

  const duplicates = duplicatesThatFire(query.data ?? [])

  const addButton = <Button onClick={() => { setError(null); setPicking(true) }}><Plus /> Add automation</Button>

  return (
    <>
      <PageHeader
        title="Automations"
        description="Ready-made rules that run on every matching order or customer event. Pick one, fill in one or two details, and it is on."
        actions={addButton}
      />
      {error && !editing && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}

      {query.isLoading ? <TableSkeleton rows={3} /> : query.error ? <Card><ErrorState onRetry={() => query.refetch()} /></Card> :
        query.data!.length === 0 ? (
          <Card><EmptyState icon={Zap} title="No automations yet" description="Start with order notifications or a review rule for large orders." action={addButton} /></Card>
        ) : (
          <ul className="space-y-3">
            {query.data!.map((a) => {
              const d = a.preset && a.preset_config ? describePreset(a.preset, a.preset_config) : { title: a.name, summary: 'Custom workflow (read-only)' }
              const Icon = a.preset === 'review_large' ? ClipboardCheck : a.preset === 'notify' ? Bell : Zap
              // Which shops it covers, and whether any of them can start it. A signup automation whose shops all have
              // signups off would sit there looking healthy while never running.
              const cfg = (a.preset_config ?? {}) as { event?: string; integration_ids?: string[]; integration_id?: string }
              const event = a.preset === 'notify' ? (cfg.event ?? 'created') : 'created'
              const selection = shopIds(cfg) ?? null
              const status = a.preset ? shopStatus(event, selection, allShops) : { waiting: false, notes: [] }
              return (
                <li key={a.id}>
                  <Card className="flex flex-wrap items-center gap-4 p-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-secondary text-muted-foreground"><Icon className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-[13px] font-semibold">{d.title}</h3>
                        <Badge tone={a.enabled ? 'success' : 'neutral'}>{a.enabled ? 'On' : 'Off'}</Badge>
                        {status.waiting && a.enabled && <Badge tone="warning">Waiting</Badge>}
                        {duplicates.has(a.id) && <Badge tone="warning">Duplicate</Badge>}
                      </div>
                      {duplicates.has(a.id) && (
                        <p role="status" className="mt-1 text-xs">
                          {duplicates.get(a.id)} automations with exactly the same settings are switched on, so every message arrives {duplicates.get(a.id) === 2 ? 'twice' : `${duplicates.get(a.id)} times`}. Switch all but one off.
                        </p>
                      )}
                      {status.waiting && (
                        <p className="mt-1 text-xs">
                          {event === 'customer_signed_up' ? 'None of the shops this covers send signups' : 'None of the shops this covers is connected'}, so this will not run.{' '}
                          <Link to="/integrations" className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Integrations</Link>
                        </p>
                      )}
                      {!status.waiting && status.notes.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">Not receiving from: {status.notes.join(', ')}.</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.summary}{a.preset && connectedShops.length > 1 ? ` · ${shopLabel(selection, allShops, event)}` : ''} · updated {timeAgo(a.updated_at)}
                      </p>
                    </div>
                    {a.preset && a.preset_config && (
                      <Button variant="outline" size="sm" onClick={() => {
                        setError(null)
                        const { integration_ids: _ids, integration_id: _id, ...rest } = a.preset_config as Record<string, unknown>
                        setEditing({ id: a.id, kind: a.preset!, config: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v)])), shops: shopIds(a.preset_config as { integration_ids?: string[]; integration_id?: string }) ?? null })
                      }}>Edit</Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => { setDeleteError(null); setDeleting(a) }} aria-label={`Delete ${d.title}`}>
                      <Trash2 /> Delete
                    </Button>
                    <Switch checked={a.enabled} disabled={!a.current_version_id} label={`${d.title}: ${a.enabled ? 'on' : 'off'}`} onChange={(next) => toggle(a, next)} />
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      <p className="mt-3 text-xs text-muted-foreground">
        Automations notify, flag and create review tasks. They do not change anything in your shop. Results appear under Executions.
      </p>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete this automation?">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm font-medium [overflow-wrap:anywhere]">
              {deleting.preset && deleting.preset_config ? describePreset(deleting.preset, deleting.preset_config).title : deleting.name}
            </p>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>It stops sending {deleting.enabled ? 'right away' : 'for good'}, and it cannot be switched on again.</li>
              <li>Its past runs stay under Executions, so nothing in your history is lost.</li>
              <li>If you only want a pause, switch it off instead.</li>
            </ul>
            {deleteError && <p role="alert" className="text-sm text-destructive">{deleteError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
              <Button variant="destructive" disabled={deleteBusy} onClick={confirmDelete}>{deleteBusy ? 'Deleting…' : 'Delete'}</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={picking} onClose={() => setPicking(false)} title="Add an automation">
        <div className="space-y-2">
          {KINDS.map(({ kind, title, text, icon: Icon }) => (
            <button key={kind} type="button" onClick={() => start(kind)}
              className="flex w-full items-start gap-3 rounded-lg border p-3 text-left outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground"><Icon className="size-4" /></span>
              <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{text}</span></span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? 'Edit automation' : editing?.kind === 'notify' ? 'Notifications' : 'Review large orders'}>
        {editing && (
          <form onSubmit={onSave} className="space-y-4">
            {editing.kind === 'notify' ? (
              <>
                <Field label="Send a message when">
                  {(id) => (
                    <Select id={id} value={editing.config.event} onChange={setEvent}>
                      <option value="created">a new order arrives</option>
                      <option value="cancelled">an order is cancelled</option>
                      <option value="status_changed">an order changes status</option>
                      <option value="customer_first_order">a new customer places their first order</option>
                      <option value="low_stock">a product runs low on stock</option>
                      <option value="products_synced">a shop syncs its products</option>
                      <option value="customer_signed_up" disabled={signupShops.length === 0 && editing.config.event !== 'customer_signed_up'}>
                        a customer signs up{signupShops.length === 0 ? ' (needs customer signups switched on)' : ''}
                      </option>
                    </Select>
                  )}
                </Field>
                {editing.config.event === 'products_synced' && (
                  <p className="-mt-2 text-xs text-muted-foreground">
                    Fires when a shop sends its products to WorkRelay, for example when someone presses the sync button in the shop's own admin.
                    The message says who did it, when the shop tells us, and a sync sent in several parts is announced once.
                    Scheduled checks and <span className="font-medium text-foreground">Sync now</span> from WorkRelay do not count.
                    You decide who is notified, here: the shop cannot turn it off. To stop it for one shop, untick that shop below, or switch the automation off.
                  </p>
                )}
                {editing.config.event === 'low_stock' && (
                  <p className="-mt-2 text-xs text-muted-foreground">
                    Covers every product. Each one alerts once when its stock reaches its own "Notify on" number (bikes at 5, nails at 5,000),
                    set per product on <Link to="/inventory" className="underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground">Inventory</Link> or sent by the shop.
                    Products without a number never alert. A shop that estimates its stock (switch it on when you edit the shop) also alerts when its
                    orders take the estimate to that number, without waiting for the shop to report again. Every message ends with its source: the
                    shop's name for a number the shop reported, or "WorkRelay (estimated for …)" for an estimate.
                  </p>
                )}
                {editing.config.event === 'customer_signed_up' && signupShops.length === 0 && (
                  <p role="alert" className="-mt-2 text-xs text-destructive">
                    No shop sends signups yet, so this would never run. Switch customer signups on under <Link to="/integrations" className="underline">Integrations</Link>, then come back.
                  </p>
                )}
                {(connectedShops.length > 1 || editing.shops !== null) && (
                  <ShopPicker shops={allShops} event={editing.config.event} value={editing.shops} onChange={(next) => setEditing((cur) => (cur ? { ...cur, shops: next } : cur))} />
                )}
                <Field label="Send it to">
                  {(id) => (
                    <Select id={id} value={editing.config.channel} onChange={set('channel')}>
                      <option value="discord">Discord</option>
                      <option value="slack">Slack</option>
                      <option value="generic">Another system (JSON webhook)</option>
                    </Select>
                  )}
                </Field>
                <Field label="Webhook URL" hint="https only. Treat it like a password: anyone with it can post to that channel. Only owners and admins can see it.">
                  {(id) => <Input id={id} type="url" required placeholder="https://discord.com/api/webhooks/…" value={editing.config.url} onChange={set('url')} autoComplete="off" />}
                </Field>
              </>
            ) : (
              <>
                <Field label="Order total above" hint="In the order's own currency, for example 100 for 100.00.">
                  {(id) => <Input id={id} type="number" min="0.01" step="0.01" required value={editing.config.threshold} onChange={set('threshold')} />}
                </Field>
                <Field label="Who can decide">
                  {(id) => (
                    <Select id={id} value={editing.config.reviewer_role} onChange={set('reviewer_role')}>
                      <option value="admin">Owners and administrators</option>
                      <option value="owner">Owners only</option>
                    </Select>
                  )}
                </Field>
                {(connectedShops.length > 1 || editing.shops !== null) && (
                  <ShopPicker shops={allShops} event="created" value={editing.shops} onChange={(next) => setEditing((cur) => (cur ? { ...cur, shops: next } : cur))} />
                )}
                <p className="text-xs text-muted-foreground">Matching orders appear under Approvals. Deciding records the decision in WorkRelay; it does not change the order in your shop.</p>
              </>
            )}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={busy || editing.shops?.length === 0 || (editing.kind === 'notify' && editing.config.event === 'customer_signed_up' && signupShops.length === 0)}>{busy ? 'Saving…' : editing.id ? 'Save changes' : 'Turn on'}</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
