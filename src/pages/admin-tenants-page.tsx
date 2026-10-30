import { useQueryClient } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { useIsPlatformAdmin, useTenants } from '@/features/admin/queries'
import { ShopRates } from '@/features/admin/shop-rates'
import { formatDate } from '@/lib/format'
import { supabase } from '@/lib/supabase'

const MESSAGES: Record<string, string> = {
  email_in_use: 'A user with that email already exists.',
  forbidden: 'Only platform admins can create tenants.',
  user_creation_failed: 'The login could not be created. Check the email and password.',
  tenant_creation_failed: 'The workspace could not be created. Nothing was saved.',
  unauthenticated: 'Your session has expired. Sign out and sign in again.',
}

async function readError(error: unknown): Promise<string> {
  try {
    const body = await (error as { context?: Response }).context?.json()
    if (body?.error === 'invalid_payload') return String(body.detail ?? 'Check the form values.')
    if (body?.error === 'unauthenticated') return `${MESSAGES.unauthenticated}${body.reason ? ` (${body.reason})` : ''}`
    if (body?.error && MESSAGES[body.error]) return MESSAGES[body.error]
  } catch {
    // fall through
  }
  // No HTTP response at all: the request never reached the function (network, CORS, or the function is not deployed).
  if (!(error as { context?: unknown } | null)?.context) return 'Could not reach the server. Check your connection and that the function is deployed.'
  return 'Something went wrong. Please try again.'
}

export function AdminTenantsPage() {
  const qc = useQueryClient()
  const admin = useIsPlatformAdmin()
  const tenants = useTenants(admin.data === true)
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
    setNotice(null)
    const email = String(data.get('email') ?? '').trim()
    const { error: invokeError } = await supabase.functions.invoke('admin-create-tenant', {
      body: { org_name: String(data.get('org_name') ?? ''), email, password },
    })
    setBusy(false)
    if (invokeError) return setError(await readError(invokeError))
    form.reset() // the password never lives in component state
    setNotice(`Tenant created. ${email} can now sign in with the password you set.`)
    void qc.invalidateQueries({ queryKey: ['admin-tenants'] })
  }

  if (admin.isLoading) return <TableSkeleton rows={4} />
  if (admin.data !== true) return <ErrorState message="This area is for platform admins only." />

  return (
    <>
      <PageHeader title="Tenants" description="Create a tenant, then see every workspace on the platform. Tenant data stays private to each tenant." />

      <Card className="mb-6">
        <CardHeader><CardTitle>Add a tenant</CardTitle></CardHeader>
        <CardBody>
          <form onSubmit={onSubmit} autoComplete="off" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Workspace name">{(id) => <Input id={id} name="org_name" maxLength={120} required />}</Field>
            <Field label="Owner email">{(id) => <Input id={id} name="email" type="email" required autoComplete="off" />}</Field>
            <Field label="Password" hint="At least 10 characters.">
              {(id) => <Input id={id} name="password" type="password" minLength={10} maxLength={72} required autoComplete="new-password" />}
            </Field>
            <Field label="Confirm password">
              {(id) => <Input id={id} name="confirm" type="password" minLength={10} maxLength={72} required autoComplete="new-password" />}
            </Field>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
              <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create tenant'}</Button>
              <span className="text-xs text-muted-foreground">The owner signs in with this email and password. Their email is marked confirmed.</span>
            </div>
            {error && <p role="alert" className="text-sm text-destructive sm:col-span-2 lg:col-span-4">{error}</p>}
            {notice && <p role="status" className="text-sm text-success sm:col-span-2 lg:col-span-4">{notice}</p>}
          </form>
        </CardBody>
      </Card>

      {tenants.data && tenants.data.length > 0 && <ShopRates tenants={tenants.data} />}

      <Card>
        <CardHeader>
          <CardTitle>All tenants{tenants.data ? ` (${tenants.data.length})` : ''}</CardTitle>
        </CardHeader>
        {tenants.isLoading ? <TableSkeleton rows={4} /> : tenants.error ? <ErrorState onRetry={() => tenants.refetch()} /> :
          tenants.data!.length === 0 ? (
            <EmptyState icon={Building2} title="No tenants yet" description="Use the form above to create the first tenant." />
          ) : (
            <Table>
              <THead>
                <tr><TH>Workspace</TH><TH>Owner</TH><TH className="text-right">Members</TH><TH className="text-right">Integrations</TH><TH className="text-right">Automations</TH><TH className="text-right">Orders</TH><TH>Currencies</TH><TH>Created</TH></tr>
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
                    <TD className="text-muted-foreground">
                      {t.currencies.length ? t.currencies.join(', ') : '—'}
                      {t.shops_without_currency > 0 && (
                        <div className="text-xs text-warning">{t.shops_without_currency} shop{t.shops_without_currency === 1 ? '' : 's'} without one</div>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{formatDate(t.created_at)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
      </Card>
    </>
  )
}
