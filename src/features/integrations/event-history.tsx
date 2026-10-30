import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Inbox } from 'lucide-react'
import { Select } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states'
import { Pagination } from '@/components/common/pagination'
import { StatusBadge } from '@/components/common/status-badge'
import { useIntegrations } from './queries'
import { shopLabel } from './shop-label'
import { useWorkspace } from '@/features/workspace/workspace-provider'
import { formatDateTime } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { WebhookEvent } from '@/types/db'

const PAGE_SIZE = 20

export function EventHistory() {
  const { current } = useWorkspace()
  const [status, setStatus] = useState('')
  const [shopId, setShopId] = useState('') // '' = all shops
  const [page, setPage] = useState(0)
  const shops = useIntegrations().data ?? []
  const showShop = shops.filter((i) => i.status !== 'revoked').length > 1 // only worth a column and a filter with several shops

  const query = useQuery({
    queryKey: ['webhook-events', current.id, status, shopId, page],
    // webhook_events is not published to Realtime (raw payloads hold customer data), so this screen polls while visible.
    refetchInterval: 5_000,
    queryFn: async () => {
      let q = supabase
        .from('webhook_events')
        .select('id, integration_id, event_id, event_type, status, error, attempt_count, received_at, processed_at', { count: 'exact' })
        .eq('organization_id', current.id)
        .order('received_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      if (status) q = q.eq('status', status)
      if (shopId) q = q.eq('integration_id', shopId)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as WebhookEvent[], total: count ?? 0 }
    },
  })

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Select
          aria-label="Filter by status"
          className="w-40"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All statuses</option>
          <option value="received">Received</option>
          <option value="processed">Processed</option>
          <option value="ignored">Ignored</option>
          <option value="failed">Failed</option>
        </Select>
        {showShop && (
          <Select aria-label="Filter by shop" className="w-44" value={shopId} onChange={(e) => { setShopId(e.target.value); setPage(0) }}>
            <option value="">All shops</option>
            {shops.filter((i) => i.status !== 'revoked').map((i) => <option key={i.id} value={i.id}>{shopLabel(i)}</option>)}
          </Select>
        )}
      </div>
      {query.isLoading ? (
        <TableSkeleton />
      ) : query.error ? (
        <ErrorState onRetry={() => query.refetch()} />
      ) : query.data!.rows.length === 0 ? (
        <EmptyState icon={Inbox} title="No events yet" description="Events appear here as soon as a connected store delivers one: orders, signups and product feeds." />
      ) : (
        <>
          <Table>
            <THead>
              <tr>
                <TH>Event</TH>
                <TH>Type</TH>
                {showShop && <TH>Shop</TH>}
                <TH>Status</TH>
                <TH>Received</TH>
                <TH>Attempts</TH>
                <TH>Diagnostic</TH>
              </tr>
            </THead>
            <tbody>
              {query.data!.rows.map((e) => (
                <TR key={e.id}>
                  <TD className="max-w-48 truncate font-mono text-xs" title={e.event_id}>{e.event_id}</TD>
                  <TD>{e.event_type ?? '—'}</TD>
                  {showShop && <TD className="text-muted-foreground [overflow-wrap:anywhere]">{((s) => (s ? shopLabel(s) : '—'))(shops.find((i) => i.id === e.integration_id))}</TD>}
                  <TD><StatusBadge status={e.status} /></TD>
                  <TD className="whitespace-nowrap">{formatDateTime(e.received_at)}</TD>
                  <TD>{e.attempt_count + 1}</TD>
                  <TD className="max-w-72 truncate text-muted-foreground" title={e.error ?? undefined}>{e.error ?? '—'}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={query.data!.total} onPage={setPage} />
        </>
      )}
    </div>
  )
}
