import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { StockPushItem } from '@/types/db'

const ITEM_LABEL: Record<StockPushItem['status'], string> = {
  pending: 'Waiting', sending: 'Sending', sent: 'Sent', failed: 'Gave up', skipped: 'Skipped', cancelled: 'Not sent',
}

/** What one request to a shop carried: each product, the number sent, why it was sent (and which side won a conflict), and how it went. */
export function RequestItems({ id, kind = 'stock', error }: { id: string; kind?: 'stock' | 'test'; error?: string | null }) {
  const q = useQuery({
    queryKey: ['stock-pushes', 'items', id],
    enabled: kind !== 'test',
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('stock_push_request_items', { p_request: id, p_limit: 100 })
      if (err) throw err
      return (data ?? []) as StockPushItem[]
    },
  })
  if (kind === 'test') {
    return <p className="text-sm text-muted-foreground">A signed test. It carries a random code and no stock numbers.{error ? ` ${error}` : ''}</p>
  }
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (q.error) return <p className="text-sm text-muted-foreground">Could not load the numbers. Close this row and open it again.</p>
  const rows = q.data ?? []
  const more = (rows[0]?.total_count ?? 0) - rows.length
  return (
    <div>
      {error && <p className="mb-2 text-sm">{error}</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 text-right font-medium">Number sent</th><th className="px-3 py-2 font-medium">Why</th><th className="px-3 py-2 font-medium">Result</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sku} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium [overflow-wrap:anywhere]">{r.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">{r.sku}</span>
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{r.stock === null ? '—' : r.stock.toLocaleString()}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {r.reason === 'conflict'
                    ? `Conflict: WorkRelay's number kept${r.conflict_shop !== null && r.conflict_workrelay !== null ? ` (the shop said ${r.conflict_shop.toLocaleString()}, WorkRelay had ${r.conflict_workrelay.toLocaleString()})` : ''}`
                    : 'Estimate changed'}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{ITEM_LABEL[r.status]}{r.note ? ` · ${r.note}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {more > 0 && <p className="mt-2 text-xs text-muted-foreground">Plus {more.toLocaleString()} more.</p>}
    </div>
  )
}
