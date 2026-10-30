import { describe as suite, expect, it } from 'vitest'
import type { OrderEvent } from '@/types/db'
import { describe } from './order-timeline'

const event = (over: Partial<OrderEvent>): OrderEvent => ({
  id: 'e1', source: 'workrelay', type: 'order.status_changed', occurred_at: '2026-10-27T10:00:00Z', actor_user_id: 'u1', data: {}, ...over,
})

suite('timeline wording', () => {
  it('spells out each field of a manual edit, with the note', () => {
    const text = describe(event({
      data: {
        applied: ['status', 'fulfillment_status'], status_from: 'pending', status_to: 'completed',
        fulfillment_from: 'unfulfilled', fulfillment_to: 'fulfilled', note: 'Handed to the courier',
      },
    }))
    expect(text).toBe('Status Pending → Completed · Fulfillment Unfulfilled → Fulfilled · Note: Handed to the courier')
  })

  it('describes a payment-only edit', () => {
    expect(describe(event({ type: 'order.updated', data: { applied: ['payment_status'], payment_from: 'paid', payment_to: 'refunded' } }))).toBe('Payment Paid → Refunded')
  })

  it('keeps the wording for events reported by the store', () => {
    const text = describe(event({ source: 'external', data: { applied: ['status'], stale: ['notes'], status_from: 'pending', status_to: 'completed' } }))
    expect(text).toBe('Status Pending → Completed · Updated: status · Ignored as outdated: notes')
  })

  it('shows an internal note as written', () => {
    expect(describe(event({ type: 'note.added', data: { note: 'Called the customer' } }))).toBe('Called the customer')
  })
})
