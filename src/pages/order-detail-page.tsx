import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/input'
import { Table, TD, TH, THead, TR } from '@/components/ui/table'
import { ErrorState, TableSkeleton } from '@/components/common/states'
import { StatusBadge } from '@/components/common/status-badge'
import { OrderTimeline } from '@/features/orders/order-timeline'
import { formatDateTime, formatMoney, humanize } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Order, OrderEvent, OrderItem } from '@/types/db'

function AddressBlock({ title, a }: { title: string; a: Order['billing_address'] }) {
  const lines = a ? [a.name, a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(' '), a.region, a.country, a.phone].filter(Boolean) : []
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {lines.length ? lines.map((l) => <p key={l} className="text-sm">{l}</p>) : <p className="text-sm text-muted-foreground">Not provided</p>}
    </div>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between py-1 text-sm"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{value}</span></div>
)

export function OrderDetailPage() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const query = useQuery({
    queryKey: ['order', id],
    queryFn: async () => {
      const [order, items, events] = await Promise.all([
        supabase.from('orders').select('*, integrations(name)').eq('id', id!).maybeSingle(),
        supabase.from('order_items').select('*').eq('order_id', id!).order('position'),
        supabase.from('order_events').select('*').eq('order_id', id!).order('occurred_at', { ascending: false }),
      ])
      for (const r of [order, items, events]) if (r.error) throw r.error
      return {
        order: order.data as unknown as Order | null,
        items: (items.data ?? []) as OrderItem[],
        events: (events.data ?? []) as OrderEvent[],
      }
    },
  })

  async function addNote(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setNoteError(null)
    const { error } = await supabase.rpc('add_order_note', { p_order: id, p_note: note })
    setSaving(false)
    if (error) return setNoteError(errorMessage(error))
    setNote('')
    void qc.invalidateQueries({ queryKey: ['order', id] })
  }

  if (query.isLoading) return <TableSkeleton rows={8} />
  if (query.error) return <ErrorState onRetry={() => query.refetch()} />
  const { order: o, items, events } = query.data!
  if (!o) return <ErrorState message="Order not found." />

  const cur = o.currency
  return (
    <>
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{o.order_number ?? `Order ${o.external_id}`}</h1>
        <StatusBadge status={o.status} />
        <StatusBadge status={o.payment_status} label={`Payment: ${humanize(o.payment_status)}`} />
        <StatusBadge status={o.fulfillment_status} label={`Fulfillment: ${humanize(o.fulfillment_status)}`} />
        {o.data_quality.length > 0 && <Badge tone="warning" title={o.data_quality.join(', ')}>Incomplete data</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Items</CardTitle></CardHeader>
            {items.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">The store has not sent line items for this order.</p>
            ) : (
              <Table>
                <THead><tr><TH>Product</TH><TH>SKU</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit price</TH><TH className="text-right">Line total</TH></tr></THead>
                <tbody>
                  {items.map((it) => (
                    <TR key={it.id}>
                      <TD>{it.name ?? '—'}</TD>
                      <TD className="font-mono text-xs">{it.sku ?? '—'}</TD>
                      <TD className="text-right tabular-nums">{it.quantity ?? '—'}</TD>
                      <TD className="text-right tabular-nums">{formatMoney(it.unit_price_minor, cur)}</TD>
                      <TD className="text-right tabular-nums">
                        {it.quantity != null && it.unit_price_minor != null ? formatMoney(it.quantity * it.unit_price_minor, cur) : '—'}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
            <CardBody className="border-t">
              <Row label="Subtotal" value={formatMoney(o.subtotal_minor, cur)} />
              <Row label="Discounts" value={formatMoney(o.discount_minor, cur)} />
              <Row label="Shipping" value={formatMoney(o.shipping_minor, cur)} />
              <Row label="Taxes" value={formatMoney(o.tax_minor, cur)} />
              <div className="mt-1 border-t pt-1 font-medium"><Row label="Total" value={formatMoney(o.total_minor, cur)} /></div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <OrderTimeline events={events} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm">{o.customer_name ?? 'Name not provided'}</p>
                <p className="text-sm text-muted-foreground">{o.customer_email ?? 'No email'}</p>
                {o.customer_phone && <p className="text-sm text-muted-foreground">{o.customer_phone}</p>}
              </div>
              <AddressBlock title="Billing" a={o.billing_address} />
              <AddressBlock title="Shipping" a={o.shipping_address} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Source</CardTitle></CardHeader>
            <CardBody className="space-y-1 text-sm">
              <Row label="Integration" value={o.integrations?.name ?? '—'} />
              <Row label="External ID" value={o.external_id} />
              <Row label="Placed" value={formatDateTime(o.placed_at)} />
              <Row label="Last event" value={formatDateTime(o.last_event_at)} />
              <Row label="Store status" value={o.external_status ?? '—'} />
              <Row label="Store payment" value={o.external_payment_status ?? '—'} />
              <Row label="Store fulfillment" value={o.external_fulfillment_status ?? '—'} />
              {o.notes && <p className="border-t pt-2 text-muted-foreground"><span className="font-medium text-foreground">Store note:</span> {o.notes}</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardBody className="space-y-3">
              <form onSubmit={addNote} className="space-y-2">
                <Textarea aria-label="Internal note" placeholder="Add an internal note (visible to your team only)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                {noteError && <p role="alert" className="text-xs text-destructive">{noteError}</p>}
                <Button type="submit" size="sm" disabled={saving || !note.trim()}>Add note</Button>
              </form>
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Changing the order status in the store is not available yet: the connected integration does not expose write
                access. WorkRelay does not process payments, refunds or shipments.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}
