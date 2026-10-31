import type { OrderPlan, StoredOrder } from './normalize.ts'

export interface IntegrationRef {
  id: string
  organizationId: string
  status: 'awaiting_bind' | 'connected' | 'revoked'
  externalStoreId: string | null
  /** The shop opted in to the customer-signup webhook (off by default). */
  trackSignups: boolean
}

export interface RecordedEvent {
  id: string
  status: 'received' | 'processed' | 'ignored' | 'failed'
  isNew: boolean
}

/** Persistence boundary for the ingestion handlers; implemented by Supabase and by an in-memory fake in tests. */
export interface IngestStore {
  findIntegrationByKeyHash(hashHex: string): Promise<IntegrationRef | null>
  touchIntegration(id: string): Promise<void>
  bindIntegration(id: string, storeId: string, baseUrl: string | null): Promise<'bound' | 'store_in_use' | 'not_awaiting'>
  recordEvent(e: {
    organizationId: string
    integrationId: string
    eventId: string
    eventType: string | null
    rawPayload: unknown
  }): Promise<RecordedEvent>
  markEvent(id: string, status: 'processed' | 'ignored' | 'failed', error?: string): Promise<void>
  getOrder(integrationId: string, externalId: string): Promise<StoredOrder | null>
  applySignup(a: {
    eventRowId: string
    organizationId: string
    integrationId: string
    eventType: 'customer.created' | 'customer.updated'
    occurredAt: string
    email: string
    name: string | null
    phone: string | null
    externalId: string | null
    registeredAt: string | null
  }): Promise<'ok' | 'disabled'>
  /** Apply a product/stock report; returns how many items were applied. */
  applyProducts(a: {
    integrationId: string
    items: Record<string, unknown>[]
    source: 'push' | 'pull'
    at: string
  }): Promise<number>
  /** A push was applied: remember when, and who pressed the button, so the app can say "synced 5 minutes ago". Best effort. */
  recordProductPush(a: { integrationId: string; byName: string | null; byRole: string | null }): Promise<void>
  /** A push was applied: tell the automations who synced (merged with the other chunks of the same sync). Best effort. */
  announceProductSync(a: { integrationId: string; byName: string | null; byRole: string | null; products: number }): Promise<void>
  applyPlan(a: {
    eventRowId: string
    organizationId: string
    integrationId: string
    externalId: string
    plan: OrderPlan
  }): Promise<'ok' | 'conflict'>
}
