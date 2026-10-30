import { describe, expect, it } from 'vitest'
import { checkTriggerShops, type ShopRow } from './trigger-shops.ts'
import type { WorkflowTrigger } from './workflow-schema.ts'

const A = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a11'
const B = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a12'
const GONE = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a13'
const shop = (id: string, name: string, over: Partial<ShopRow> = {}): ShopRow => ({ id, name, status: 'connected', track_signups: false, ...over })
const check = (trigger: WorkflowTrigger, shops: ShopRow[]) => checkTriggerShops(trigger, shops)

describe('shops named by a trigger', () => {
  it('accepts all shops, or chosen shops of the workspace, for order and first-order triggers', () => {
    const shops = [shop(A, 'Alpha'), shop(B, 'Beta')]
    expect(check({ type: 'order_created' }, shops)).toBeNull()
    expect(check({ type: 'order_created', integration_ids: [A] }, shops)).toBeNull()
    expect(check({ type: 'order_status_changed', to_status: 'cancelled', integration_ids: [A, B] }, shops)).toBeNull()
    expect(check({ type: 'customer_first_order', integration_ids: [B] }, shops)).toBeNull()
  })

  it('refuses a shop that is not in the workspace, and a disconnected one by name', () => {
    expect(check({ type: 'order_created', integration_ids: [GONE] }, [shop(A, 'Alpha')])).toMatch(/does not belong/)
    expect(check({ type: 'order_created', integration_ids: [A] }, [shop(A, 'Alpha', { status: 'revoked' })])).toMatch(/Alpha is disconnected/)
  })

  it('needs signups switched on for every chosen shop, naming the ones that are off', () => {
    const shops = [shop(A, 'Alpha', { track_signups: true }), shop(B, 'Beta')]
    expect(check({ type: 'customer_signup', integration_ids: [A] }, shops)).toBeNull()
    expect(check({ type: 'customer_signup', integration_ids: [A, B] }, shops)).toMatch(/off for Beta/)
    expect(check({ type: 'customer_signup', integration_ids: [B] }, shops)).toMatch(/off for Beta/)
  })

  it('for "all shops" needs at least one connected shop that sends signups', () => {
    expect(check({ type: 'customer_signup' }, [shop(A, 'Alpha'), shop(B, 'Beta')])).toMatch(/Turn on customer signups/)
    expect(check({ type: 'customer_signup' }, [shop(A, 'Alpha', { track_signups: true, status: 'revoked' })])).toMatch(/Turn on customer signups/)
    expect(check({ type: 'customer_signup' }, [shop(A, 'Alpha'), shop(B, 'Beta', { track_signups: true })])).toBeNull()
  })

  it('still understands the older single-shop signup trigger', () => {
    expect(check({ type: 'customer_signup', integration_id: A }, [shop(A, 'Alpha')])).toMatch(/off for Alpha/)
    expect(check({ type: 'customer_signup', integration_id: A }, [shop(A, 'Alpha', { track_signups: true })])).toBeNull()
  })

  it('does not look at the webhook or manual triggers', () => {
    expect(check({ type: 'manual' }, [])).toBeNull()
    expect(check({ type: 'webhook', integration_id: GONE }, [])).toBeNull()
  })
})
