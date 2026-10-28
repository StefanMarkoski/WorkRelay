import { describe, expect, it } from 'vitest'
import { processRun, type EngineStore, type HttpClient, type RunRow, type StepRecord } from './engine.ts'
import { buildPresetDefinition, describePreset, type NotifyConfig } from './presets.ts'
import { renderTemplate, templateView } from './template.ts'
import { validateDefinition } from './workflow-schema.ts'

const URL_OK = 'https://discord.com/api/webhooks/123/SECRET-TOKEN'
const order = { external_id: '1001', order_number: '#1001', customer_name: 'Ana "The Boss" Petrova\nline2', customer_email: 'ana@example.com', total_minor: 15000, currency: 'EUR', status: 'cancelled', payment_status: 'paid', fulfillment_status: 'unfulfilled' }

describe('templates', () => {
  it('adds friendly fields to the view', () => {
    const v = templateView({ order }) as any
    expect(v.order.display_number).toBe('#1001')
    expect(v.order.total).toBe('150.00 EUR')
    expect((templateView({ order: { external_id: '7' } }) as any).order).toMatchObject({ display_number: '#7', customer: 'unknown customer', total: 'no total' })
  })
  it('escapes values for JSON string literals', () => {
    const out = renderTemplate('{"m":"{{order.customer}}"}', templateView({ order }), { json: true })
    expect(JSON.parse(out).m).toBe('Ana "The Boss" Petrova\nline2')
  })
  it('renders plain text and tolerates missing values', () => {
    expect(renderTemplate('Hi {{order.nope}}|{{ order.status }}', templateView({ order }))).toBe('Hi |cancelled')
  })
})

describe('presets', () => {
  const channels = ['discord', 'slack', 'generic'] as const
  const events = ['created', 'cancelled', 'status_changed'] as const

  it.each(channels.flatMap((c) => events.map((e) => [c, e] as const)))('notify %s / %s builds a valid definition and valid JSON', (channel, event) => {
    const r = buildPresetDefinition('notify', { channel, event, url: URL_OK })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(validateDefinition(r.definition).ok).toBe(true)
    const step = r.definition.steps[0] as any
    const rendered = renderTemplate(step.body, templateView({ order }), { json: true })
    const parsed = JSON.parse(rendered) // hostile customer text must not break the payload
    expect(JSON.stringify(parsed)).toContain('#1001')
  })

  it('maps events to triggers', () => {
    const t = (event: string) => (buildPresetDefinition('notify', { channel: 'slack', event, url: URL_OK }) as any).definition.trigger
    expect(t('created')).toEqual({ type: 'order_created' })
    expect(t('cancelled')).toEqual({ type: 'order_status_changed', to_status: 'cancelled' })
    expect(t('status_changed')).toEqual({ type: 'order_status_changed' })
  })

  it('refuses unsafe destinations and bad config', () => {
    for (const url of ['http://discord.com/x', 'https://169.254.169.254/x', 'https://localhost/x', 'not a url', '']) {
      expect(buildPresetDefinition('notify', { channel: 'discord', event: 'created', url }).ok, url).toBe(false)
    }
    expect(buildPresetDefinition('notify', { channel: 'sms', event: 'created', url: URL_OK }).ok).toBe(false)
    expect(buildPresetDefinition('review_large', { threshold: 0, reviewer_role: 'admin' }).ok).toBe(false)
    expect(buildPresetDefinition('review_large', { threshold: 10, reviewer_role: 'member' }).ok).toBe(false)
  })

  it('review preset converts the threshold to minor units and builds a valid definition', () => {
    const r = buildPresetDefinition('review_large', { threshold: 99.99, reviewer_role: 'admin' })
    expect(r.ok && validateDefinition(r.definition).ok).toBe(true)
    expect(r.ok && (r.definition.steps[0] as any).value).toBe(9999)
  })

  it('descriptions never include the full destination URL', () => {
    const d = describePreset('notify', { channel: 'discord', event: 'created', url: URL_OK })
    expect(JSON.stringify(d)).not.toContain('SECRET-TOKEN')
    expect(d.summary).toContain('discord.com')
  })
})

describe('presets running on the engine', () => {
  class Store implements EngineStore {
    def: unknown
    steps: StepRecord[] = []
    approvals: { title: string; context: unknown }[] = []
    run: any = {}
    async claimRuns(): Promise<RunRow[]> { return [] }
    async sweepTimeouts() { return 0 }
    async loadDefinition(_v?: string) { return this.def }
    async countStepRuns() { return this.steps.length }
    async insertStepRun(r: StepRecord) { this.steps.push(r) }
    async getApproval() { return this.approvals.length ? { status: 'pending' as const } : null }
    async createApproval(a: { title: string; context: unknown }) { this.approvals.push(a) }
    async saveRun(_id: string, p: any) { Object.assign(this.run, p); return true }
  }
  const mkRun = (): RunRow => ({ id: 'r', organization_id: 'o', workflow_id: 'w', version_id: 'v', attempt: 1, step_attempt: 0, current_step_key: null, deadline_at: null, context: { order, event: { type: 'order.created' } } })
  const log = { info() {}, error() {} }

  it('notify sends a rendered, valid JSON body and keeps the token out of history', async () => {
    const store = new Store()
    store.def = (buildPresetDefinition('notify', { channel: 'discord', event: 'cancelled', url: URL_OK } as NotifyConfig) as any).definition
    const sent: { url: string; body?: string }[] = []
    const http: HttpClient = { async request(r) { sent.push(r); return { status: 204, body: '' } } }
    await processRun(mkRun(), { store, http, log })
    expect(store.run.status).toBe('succeeded')
    expect(sent[0].url).toBe(URL_OK)
    const message = JSON.parse(sent[0].body!).content as string
    expect(message).toBe('Order #1001 was cancelled (150.00 EUR)')
    expect(JSON.stringify(store.steps)).not.toContain('SECRET-TOKEN')
  })

  it('review creates an approval for large orders and skips small ones', async () => {
    const big = new Store()
    big.def = (buildPresetDefinition('review_large', { threshold: 100, reviewer_role: 'admin' }) as any).definition
    await processRun(mkRun(), { store: big, http: { async request() { throw new Error('no http') } }, log })
    expect(big.run.status).toBe('waiting_approval')
    expect(big.approvals[0].title).toBe('Review large order #1001 (150.00 EUR)')

    const small = new Store()
    small.def = (buildPresetDefinition('review_large', { threshold: 500, reviewer_role: 'admin' }) as any).definition
    await processRun(mkRun(), { store: small, http: { async request() { throw new Error('no http') } }, log })
    expect(small.run.status).toBe('succeeded')
    expect(small.approvals).toHaveLength(0)
  })
})
