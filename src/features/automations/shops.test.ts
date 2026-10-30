import { describe, expect, it } from 'vitest'
import { eligibleShops, normalizeSelection, reconcileSelection, shopLabel, shopStatus, toggleShop } from './shops'

const shop = (id: string, over: Partial<Parameters<typeof eligibleShops>[0][number]> = {}) => ({ id, name: `Shop ${id}`, status: 'connected' as const, track_signups: false, ...over })
const A = shop('A', { track_signups: true })
const B = shop('B')
const C = shop('C', { status: 'revoked' })
const D = shop('D', { track_signups: true })

describe('which shops an automation can use', () => {
  it('offers connected shops, and for signups only those that send them', () => {
    expect(eligibleShops([A, B, C], 'created').map((s) => s.id)).toEqual(['A', 'B'])
    expect(eligibleShops([A, B, C], 'customer_first_order').map((s) => s.id)).toEqual(['A', 'B'])
    expect(eligibleShops([A, B, C], 'low_stock').map((s) => s.id)).toEqual(['A', 'B']) // stock needs no opt-in
    expect(eligibleShops([A, B, C], 'products_synced').map((s) => s.id)).toEqual(['A', 'B'])
    expect(eligibleShops([A, B, C, D], 'customer_signed_up').map((s) => s.id)).toEqual(['A', 'D'])
  })
})

describe('the selection', () => {
  it('ticking every shop is "All shops", so it also covers shops added later', () => {
    expect(normalizeSelection(['A', 'B'], [A, B])).toBeNull()
    expect(normalizeSelection(['B', 'A'], [A, B])).toBeNull()
    expect(normalizeSelection(['A'], [A, B])).toEqual(['A'])
    expect(normalizeSelection([], [A, B])).toEqual([]) // empty stays empty: it cannot be saved
    expect(normalizeSelection(null, [A, B])).toBeNull()
  })

  it('unticking one shop from "All shops" leaves the rest, and ticking it back returns to all', () => {
    expect(toggleShop(null, 'A', [A, B, D])).toEqual(['B', 'D'])
    expect(toggleShop(['B', 'D'], 'A', [A, B, D])).toBeNull()
    expect(toggleShop(['A'], 'A', [A, B])).toEqual([])
  })

  it('drops shops that stop qualifying when the event changes', () => {
    expect(reconcileSelection(['A', 'B'], eligibleShops([A, B], 'customer_signed_up'))).toBeNull() // only A qualifies: [A] is all of them
    expect(reconcileSelection(['B'], eligibleShops([A, B], 'customer_signed_up'))).toEqual([])
    expect(reconcileSelection(null, eligibleShops([A, B], 'customer_signed_up'))).toBeNull()
  })

  it('for signups on all shops, says which shops are sending right now', () => {
    expect(shopLabel(null, [A, D], 'customer_signed_up')).toBe('All shops') // everyone sends
    expect(shopLabel(null, [A, B], 'customer_signed_up')).toBe('Shops sending signups: Shop A') // B has signups off
    expect(shopLabel(null, [B, C], 'customer_signed_up')).toBe('All shops, none sending signups')
    expect(shopLabel(null, [A, B], 'created')).toBe('All shops') // other automations are not limited by the signup switch
    expect(shopLabel(null, [A, B])).toBe('All shops')
  })

  it('labels it for a card', () => {
    expect(shopLabel(null, [A, B])).toBe('All shops')
    expect(shopLabel(['A'], [A, B])).toBe('Shop A')
    expect(shopLabel(['A', 'B'], [A, B, D])).toBe('Shop A, Shop B')
    expect(shopLabel(['A', 'B', 'D'], [A, B, D])).toBe('Shop A, Shop B +1')
    expect(shopLabel(['gone'], [A])).toBe('a removed shop')
  })
})

describe('whether a saved automation can run', () => {
  it('signups for all shops wait only when no shop sends them, and name the shops left out', () => {
    expect(shopStatus('customer_signed_up', null, [B, C])).toEqual({ waiting: true, notes: ['Shop B has signups off'] })
    expect(shopStatus('customer_signed_up', null, [A, B])).toEqual({ waiting: false, notes: ['Shop B has signups off'] })
    expect(shopStatus('customer_signed_up', null, [A, D])).toEqual({ waiting: false, notes: [] })
  })

  it('signups for chosen shops name the ones that are not sending, and wait only if none are', () => {
    expect(shopStatus('customer_signed_up', ['A', 'B'], [A, B])).toEqual({ waiting: false, notes: ['Shop B has signups off'] })
    expect(shopStatus('customer_signed_up', ['B'], [A, B])).toEqual({ waiting: true, notes: ['Shop B has signups off'] })
    expect(shopStatus('customer_signed_up', ['A', 'C'], [A, C])).toEqual({ waiting: false, notes: ['Shop C is disconnected'] })
  })

  it('order automations for chosen shops notice a disconnected or removed shop', () => {
    expect(shopStatus('created', ['A', 'C'], [A, C])).toEqual({ waiting: false, notes: ['Shop C is disconnected'] })
    expect(shopStatus('created', ['C'], [A, C])).toEqual({ waiting: true, notes: ['Shop C is disconnected'] })
    expect(shopStatus('created', ['gone'], [A])).toEqual({ waiting: true, notes: ['a removed shop'] })
    expect(shopStatus('created', ['A', 'B'], [A, B])).toEqual({ waiting: false, notes: [] })
  })

  it('all shops never waits for an order automation, even with no shops yet', () => {
    expect(shopStatus('created', null, [])).toEqual({ waiting: false, notes: [] })
  })
})
