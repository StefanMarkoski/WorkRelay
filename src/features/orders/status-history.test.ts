import { describe, expect, it } from 'vitest'
import type { OrderEvent } from '@/types/db'
import { editLines } from './order-timeline'
import { author, statusSteps } from './status-history'

const ev = (id: string, at: string, over: Partial<OrderEvent> = {}): OrderEvent => ({
  id, source: 'external', type: 'order.status_changed', occurred_at: at, actor_user_id: null, data: {}, ...over,
})
const people = { u1: 'ana@shop.example' }

describe('status history', () => {
  it('lists each status the order was in, oldest first, with who moved it', () => {
    const steps = statusSteps(
      [
        ev('c', '2026-10-27T12:00:00Z', { source: 'workrelay', actor_user_id: 'u1', data: { status_to: 'completed' } }),
        ev('a', '2026-10-27T10:00:00Z', { type: 'order.created', data: { status_to: 'pending' } }),
        ev('b', '2026-10-27T11:00:00Z', { data: { status_to: 'processing' } }),
      ],
      people,
    )
    expect(steps.map((s) => [s.status, s.by])).toEqual([['pending', 'Store'], ['processing', 'Store'], ['completed', 'ana@shop.example']])
  })

  it('skips events that did not change the status or repeat it', () => {
    const steps = statusSteps(
      [
        ev('a', '2026-10-27T10:00:00Z', { data: { status_to: 'pending' } }),
        ev('n', '2026-10-27T10:30:00Z', { source: 'workrelay', type: 'note.added', data: { note: 'hi' } }),
        ev('s', '2026-10-27T10:40:00Z', { data: { stale: ['status'], status_to: null } }),
        ev('r', '2026-10-27T11:00:00Z', { data: { status_to: 'pending' } }),
      ],
      people,
    )
    expect(steps).toHaveLength(1)
  })

  it('names someone who has left the workspace without breaking', () => {
    expect(author(ev('x', '2026-10-27T10:00:00Z', { source: 'workrelay', actor_user_id: 'gone' }), people)).toBe('A former team member')
  })

  it('writes one line per changed field of an edit', () => {
    expect(editLines(ev('x', '2026-10-27T10:00:00Z', { source: 'workrelay', data: { status_from: 'pending', status_to: 'completed', payment_from: 'paid', payment_to: 'refunded' } })))
      .toEqual(['Status Pending → Completed', 'Payment Paid → Refunded'])
  })
})
