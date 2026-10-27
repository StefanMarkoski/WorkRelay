import { useQueryClient } from '@tanstack/react-query'
import { Building2, Plus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { useIsPlatformAdmin, useTenants } from '@/features/admin/queries'
import { formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase'

const MESSAGES: Record<string, string> = {
  email_in_use: 'A user with that email already exists.',
  forbidden: 'Only platform admins can create tenants.',
  user_creation_failed: 'The login could not be created. Check the email and password.',
  tenant_creation_failed: 'The workspace could not be created. Nothing was saved.',
}

async function readError(error: unknown): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.json()
    if (body?.error === 'invalid_payload') return String(body.detail ?? 'Check the form values.')
    if (body?.error && MESSAGES[body.error]) return MESSAGES[body.error]
  } catch {
    // fall through
  }
  return 'Something went wrong. Please try again.'
}

export function AdminTenantsPage() {
  const qc = useQueryClient()
  const admin = useIsPlatformAdmin()
  const tenants = useTenants(admin.data === true)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const password = String(data.get('password') ?? '')
    if (password !== String(data.get('confirm') ?? '')) return setError('The passwords do not match.')
    setBusy(true)
    setError(null)
    const email = String(data.get('email') ?? '').trim()
    const { error: invokeError } = await supabase.functions.invoke('admin-create-tenant', {
      body: { org_name: String(data.get('org_name') ?? ''), email, password },
    })
    setBusy(false)
    if (invokeError) return setError(await readError(invokeError))
    form.reset() // the password never lives in component state
    setOpen(false)
    setNotice(`Tenant created. ${email} can now sign in with the password you set.`)
    void qc.invalidateQueries({ queryKey: ['admin-tenants'] })
  }

  if (admin.isLoading) return <TableSkeleton rows={4} />
  if (admin.data !== true) return <ErrorState message="This area is for platform admins only." />

  const addButton = (
    <Button onClick={() => { setError(null); setNotice(null); setOpen(true) }}>
      <Plus /> Add tenant
    </Button>
  )

  return (
    <>
      <PageHeader title="Tenants" description="Every workspace on the platform. Tenant data stays private to each tenant." actions={addButton} />
      {notice && <p role="status" className="mb-3 text-sm text-success">{notice}</p>}
      <Card>
        {tenants.isLoading ? <TableSkeleton rows={4} /> : tenants.error ? <ErrorState onRetry={() => tenants.refetch()} /> :
          tenants.data!.length === 0 ? (
            <EmptyState icon={Building2} title="No tenants yet" description="Add a tenant to create its workspace and the owner's login." action={addButton} />
          ) : (
            <Table>
              <THead>
                <tr><TH>Workspace</TH><TH>Owner</TH><TH className="text-right">Members</TH><TH className="text-right">Integrations</TH><TH className="text-right">Workflows</TH><TH className="text-right">Orders</TH><TH>Created</TH></tr>
              </THead>
              <tbody>
                {tenants.data!.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium">{t.name}</TD>
                    <TD className="text-muted-foreground">{t.owner_emails.join(', ') || '—'}</TD>
                    <TD className="text-right tabular-nums">{t.members}</TD>
                    <TD className="text-right tabular-nums">{t.integrations}</TD>
                    <TD className="text-right tabular-nums">{t.workflows}</TD>
                    <TD className="text-right tabular-nums">{t.orders}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(t.created_at)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Add a tenant">
        <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
          <Field label="Workspace name">{(id) => <Input id={id} name="org_name" maxLength={120} required autoFocus />}</Field>
          <Field label="Owner email" hint="This person signs in with it. Their email is marked confirmed.">
            {(id) => <Input id={id} name="email" type="email" required autoComplete="off" />}
          </Field>
          <Field label="Password" hint="At least 10 characters. Share it with the owner securely.">
            {(id) => <Input id={id} name="password" type="password" minLength={10} maxLength={72} required autoComplete="new-password" />}
          </Field>
          <Field label="Confirm password">
            {(id) => <Input id={id} name="confirm" type="password" minLength={10} maxLength={72} required autoComplete="new-password" />}
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create tenant'}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
