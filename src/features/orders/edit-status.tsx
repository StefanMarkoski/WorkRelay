import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { humanize } from '@/lib/format'
import { errorMessage, supabase } from '@/lib/supabase'
import type { Order } from '@/types/db'

// The values WorkRelay understands. "unknown" is what it stores when it cannot read the shop's word, so it is not offered.
const STATUS = ['pending', 'processing', 'completed', 'cancelled']
const PAYMENT = ['unpaid', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed']
const FULFILLMENT = ['unfulfilled', 'partial', 'fulfilled', 'returned']
// Picking one of these asks for a second click, because it is hard to take back with a customer watching.
const RISKY = new Set(['cancelled', 'refunded', 'failed', 'returned'])

const withCurrent = (values: string[], current: string) => (values.includes(current) ? values : [current, ...values])

/** Owner/admin edit of an order's three statuses. The change is recorded on the timeline and can start automations. */
export function EditStatus({ order, onSaved }: { order: Order; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(order.status)
  const [payment, setPayment] = useState(order.payment_status)
  const [fulfillment, setFulfillment] = useState(order.fulfillment_status)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const changes = [
    status !== order.status && { label: 'Status', from: order.status, to: status },
    payment !== order.payment_status && { label: 'Payment', from: order.payment_status, to: payment },
    fulfillment !== order.fulfillment_status && { label: 'Fulfillment', from: order.fulfillment_status, to: fulfillment },
  ].filter(Boolean) as { label: string; from: string; to: string }[]
  const risky = changes.some((c) => RISKY.has(c.to))

  function openDialog() {
    setStatus(order.status)
    setPayment(order.payment_status)
    setFulfillment(order.fulfillment_status)
    setNote('')
    setConfirming(false)
    setError(null)
    setOpen(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (changes.length === 0) return
    if (risky && !confirming) return setConfirming(true)
    setSaving(true)
    setError(null)
    const { error } = await supabase.rpc('set_order_statuses', {
      p_order: order.id,
      p_status: status !== order.status ? status : null,
      p_payment: payment !== order.payment_status ? payment : null,
      p_fulfillment: fulfillment !== order.fulfillment_status ? fulfillment : null,
      p_note: note.trim() || null,
    })
    setSaving(false)
    if (error) return setError(errorMessage(error))
    setOpen(false)
    onSaved()
  }

  const field = (label: string, value: string, set: (v: string) => void, values: string[]) => (
    <Field label={label}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => { set(e.target.value); setConfirming(false) }}>
          {withCurrent(values, value).map((v) => (
            <option key={v} value={v} disabled={!values.includes(v)}>{humanize(v)}</option>
          ))}
        </Select>
      )}
    </Field>
  )

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>Edit status</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit order status">
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {field('Status', status, setStatus, STATUS)}
            {field('Payment', payment, setPayment, PAYMENT)}
            {field('Fulfillment', fulfillment, setFulfillment, FULFILLMENT)}
          </div>
          <Field label="Note (optional)" hint="Shown on the order timeline.">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />}
          </Field>
          <p className="text-xs text-muted-foreground">
            This changes the order in WorkRelay only. The store is not told, and a newer update from the store will replace it.
            A new status can start any automation that listens for it.
          </p>
          {confirming && (
            <p role="alert" className="text-sm">
              Confirm: {changes.map((c) => `${c.label} ${humanize(c.from)} → ${humanize(c.to)}`).join(', ')}.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || changes.length === 0}>{confirming ? 'Yes, change it' : 'Save'}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
