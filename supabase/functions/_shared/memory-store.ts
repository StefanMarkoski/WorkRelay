import type { StoredOrder } from './normalize.ts'
import { sha256Hex } from './keys.ts'
import type { IngestStore, IntegrationRef, RecordedEvent } from './store.ts'

interface EventRow extends RecordedEvent {
  integrationId: string
  eventId: string
  rawPayload: unknown
  error?: string
  attempts: number
}

/** Test double mirroring the SQL semantics (unique keys, optimistic version check). */
export class MemoryStore implements IngestStore {
  integrations = new Map<string, IntegrationRef & { keyHash: string }>()
  events: EventRow[] = []
  orders = new Map<string, StoredOrder & { id: string }>()
  items = new Map<string, unknown[]>()
  /** What applySignup was asked to apply (the real logic is the apply_customer_signup SQL function). */
  signups: Parameters<IngestStore['applySignup']>[0][] = []
  timeline: { orderId: string; type: string; data: Record<string, unknown> }[] = []
  /** Test hook: force the next N applyPlan calls to report a version conflict. */
  forceConflicts = 0
  nextId = 1

  async addIntegration(key: string, init: Partial<IntegrationRef> = {}) {
    const ref = {
      id: `int_${this.nextId++}`,
      organizationId: `org_${this.nextId++}`,
      status: 'awaiting_bind' as const,
      externalStoreId: null,
      trackSignups: false,
      keyHash: await sha256Hex(key),
      ...init,
    }
    this.integrations.set(ref.id, ref)
    return ref
  }

  async findIntegrationByKeyHash(hash: string) {
    return [...this.integrations.values()].find((i) => i.keyHash === hash) ?? null
  }
  async touchIntegration() {}

  async bindIntegration(id: string, storeId: string) {
    const i = this.integrations.get(id)!
    if (i.status !== 'awaiting_bind') return 'not_awaiting' as const
    const taken = [...this.integrations.values()].some((o) => o.status === 'connected' && o.externalStoreId === storeId)
    if (taken) return 'store_in_use' as const
    i.status = 'connected'
    i.externalStoreId = storeId
    return 'bound' as const
  }

  async recordEvent(e: { integrationId: string; eventId: string; rawPayload: unknown }) {
    const existing = this.events.find((x) => x.integrationId === e.integrationId && x.eventId === e.eventId)
    if (existing) {
      if (existing.status === 'failed' || existing.status === 'received' || (existing.status === 'ignored' && String(existing.error ?? '').startsWith('signups_off'))) {
        existing.attempts++
        existing.rawPayload = e.rawPayload
        existing.status = 'received'
        existing.error = undefined
      }
      return { id: existing.id, status: existing.status, isNew: false }
    }
    const row: EventRow = {
      id: `ev_${this.nextId++}`,
      status: 'received',
      isNew: true,
      integrationId: e.integrationId,
      eventId: e.eventId,
      rawPayload: e.rawPayload,
      attempts: 0,
    }
    this.events.push(row)
    return { id: row.id, status: row.status, isNew: true }
  }

  async markEvent(id: string, status: 'processed' | 'ignored' | 'failed', error?: string) {
    const row = this.events.find((e) => e.id === id)!
    row.status = status
    row.error = error
  }

  async getOrder(integrationId: string, externalId: string) {
    const o = this.orders.get(`${integrationId}:${externalId}`)
    return o ? structuredClone(o) : null
  }

  async applySignup(a: Parameters<IngestStore['applySignup']>[0]) {
    if (!this.integrations.get(a.integrationId)?.trackSignups) {
      await this.markEvent(a.eventRowId, 'ignored', 'signups_off: signup tracking is off for this shop')
      return 'disabled' as const
    }
    this.signups.push(a)
    await this.markEvent(a.eventRowId, 'processed')
    return 'ok' as const
  }

  /** Product reports as applied. pushEnabled is set per integration by tests (the real rule is in apply_product_sync). */
  productReports: Parameters<IngestStore['applyProducts']>[0][] = []
  pushEnabled = new Set<string>()
  async applyProducts(a: Parameters<IngestStore['applyProducts']>[0]) {
    if (a.source === 'push' && !this.pushEnabled.has(a.integrationId)) return 'disabled' as const
    this.productReports.push(a)
    return a.items.length
  }

  /** The pushes the handler remembered (the real storage is the record_product_push SQL function). */
  pushRecords: Parameters<IngestStore['recordProductPush']>[0][] = []
  failPushRecords = false
  async recordProductPush(a: Parameters<IngestStore['recordProductPush']>[0]) {
    if (this.failPushRecords) throw new Error('db down')
    this.pushRecords.push(a)
  }

  /** What the push handler announced (the real merging is the announce_products_synced SQL function). */
  announcements: Parameters<IngestStore['announceProductSync']>[0][] = []
  failAnnouncements = false
  async announceProductSync(a: Parameters<IngestStore['announceProductSync']>[0]) {
    if (this.failAnnouncements) throw new Error('db down')
    this.announcements.push(a)
  }

  async applyPlan(a: Parameters<IngestStore['applyPlan']>[0]) {
    if (this.forceConflicts > 0) {
      this.forceConflicts--
      return 'conflict' as const
    }
    const key = `${a.integrationId}:${a.externalId}`
    const cur = this.orders.get(key)
    if ((cur?.version ?? null) !== a.plan.expectedVersion) return 'conflict' as const
    const id = cur?.id ?? `ord_${this.nextId++}`
    this.orders.set(key, { ...a.plan.fields, id, version: (cur?.version ?? 0) + 1 })
    if (a.plan.items) this.items.set(id, a.plan.items)
    this.timeline.push({ orderId: id, type: a.plan.timeline.type, data: a.plan.timeline.data })
    await this.markEvent(a.eventRowId, 'processed')
    return 'ok' as const
  }
}
