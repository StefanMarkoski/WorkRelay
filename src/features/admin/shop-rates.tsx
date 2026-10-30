import { useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { ErrorState, TableSkeleton } from '@/components/common/states'
import { formatSyncPace, maxSyncCalls, timeAgo } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { TenantShop } from '@/types/db'
import { useTenantShops, type Tenant } from './queries'

/**
 * How often WorkRelay may call each shop of a tenant, as "calls per days". Only platform admins can change it (the
 * database refuses everyone else), so tenants see the result on Settings → API Calls but cannot edit it.
 */
export function ShopRates({ tenants }: { tenants: Tenant[] }) {
  const [orgId, setOrgId] = useState('')
  const shops = useTenantShops(orgId)

  return (
    <Card className="mb-6">
      <CardHeader><CardTitle>API calls per shop</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        <p className="max-w-3xl text-sm text-muted-foreground">
          How many times WorkRelay may call a shop's product feed, as calls per number of days. 15 calls per 1 day is about one call every 1h 36m;
          200 per 7 days is about every 50 minutes. The fastest allowed is one call every 5 minutes. Tenants can see this but not change it.
        </p>
        <div className="max-w-sm">
          <Field label="Tenant">
            {(id) => (
              <Select id={id} value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                <option value="">Choose a tenant…</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
      </CardBody>
      {orgId !== '' && (shops.isLoading ? <TableSkeleton rows={2} /> : shops.error ? <ErrorState onRetry={() => shops.refetch()} /> :
        shops.data!.length === 0 ? (
          <p className="border-t p-4 text-sm text-muted-foreground">This tenant has no shops yet.</p>
        ) : (
          <Table>
            <THead><tr><TH>Shop</TH><TH colSpan={3}>Calls per days</TH><TH className="hidden md:table-cell">Last check</TH><TH><span className="sr-only">Save</span></TH></tr></THead>
            <tbody>
              {shops.data!.map((s) => <RateRow key={`${s.id}:${s.calls}:${s.days}`} shop={s} orgId={orgId} />)}
            </tbody>
          </Table>
        ))}
    </Card>
  )
}

function RateRow({ shop, orgId }: { shop: TenantShop; orgId: string }) {
  const qc = useQueryClient()
  const [calls, setCalls] = useState(shop.calls?.toString() ?? '')
  const [days, setDays] = useState(shop.days?.toString() ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const c = calls.trim() === '' ? null : Number(calls)
  const d = days.trim() === '' ? null : Number(days)
  const empty = c === null && d === null
  const problem =
    empty ? null
    : c === null || d === null ? 'Fill in both numbers, or clear both.'
    : !Number.isInteger(c) || !Number.isInteger(d) || c < 1 || d < 1 ? 'Whole numbers, at least 1.'
    : d > 365 ? 'Days: at most 365.'
    : c > maxSyncCalls(d) ? `At most ${maxSyncCalls(d).toLocaleString()} calls per ${d === 1 ? 'day' : `${d} days`} (one every 5 minutes).`
    : c > 100000 ? 'Calls: at most 100,000.'
    : null
  const unchanged = (c ?? null) === shop.calls && (d ?? null) === shop.days

  async function save(e: FormEvent) {
    e.preventDefault()
    if (problem) return
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('admin_set_sync_rate', { p_integration: shop.id, p_calls: c, p_days: d })
    setBusy(false)
    if (rpcError) return setError(errorMessage(rpcError))
    void qc.invalidateQueries({ queryKey: ['admin-tenant-shops', orgId] })
  }

  return (
    <TR>
      <TD className="min-w-32 font-medium [overflow-wrap:anywhere]">{shop.name}</TD>
      <TD colSpan={3} className="p-0">
        <form id={`rate-${shop.id}`} onSubmit={save} className="flex flex-wrap items-center gap-3 px-4 py-2">
          <Input aria-label={`Calls for ${shop.name}`} inputMode="numeric" className="h-8 w-20 tabular-nums" value={calls} onChange={(e) => setCalls(e.target.value)} placeholder="—" />
          <span className="text-xs text-muted-foreground">per</span>
          <Input aria-label={`Days for ${shop.name}`} inputMode="numeric" className="h-8 w-16 tabular-nums" value={days} onChange={(e) => setDays(e.target.value)} placeholder="—" />
          <span className="text-xs text-muted-foreground">days</span>
          <span className="min-w-32 text-xs text-muted-foreground">
            {problem ? <span role="alert" className="text-destructive">{problem}</span> : empty ? 'Not scheduled' : formatSyncPace(c, d)}
          </span>
        </form>
        {error && <p role="alert" className="px-4 pb-2 text-xs text-destructive">{error}</p>}
      </TD>
      <TD className="hidden whitespace-nowrap text-muted-foreground md:table-cell">
        {shop.last_error ? <span className="text-destructive" title={shop.last_error}>Failed</span> : shop.last_sync_at ? timeAgo(shop.last_sync_at) : 'Never'}
      </TD>
      <TD className="text-right">
        <Button type="submit" form={`rate-${shop.id}`} size="sm" disabled={busy || unchanged || problem !== null}>{busy ? 'Saving…' : empty && shop.calls !== null ? 'Remove' : 'Save'}</Button>
      </TD>
    </TR>
  )
}
