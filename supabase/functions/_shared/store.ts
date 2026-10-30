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
  applyPlan(a: {
    eventRowId: string
    organizationId: string
    integrationId: string
    externalId: string
    plan: OrderPlan
  }): Promise<'ok' | 'conflict'>
}
