import { beforeEach, describe, expect, it } from 'vitest'
import {
  HttpError, MAX_STEP_ATTEMPTS, processRun, tick,
  type EngineStore, type HttpClient, type RunPatch, type RunRow, type StepRecord,
} from './engine.ts'
import type { Logger } from './log.ts'
import { redact, redactUrl } from './redact.ts'

const log: Logger = { info() {}, error() {} }
const T0 = new Date('2026-10-27T10:00:00Z')

class FakeStore implements EngineStore {
  definition: unknown = {}
  run!: RunRow & { status: string; error?: string | null; next_run_at?: string; finished_at?: string }
  steps: StepRecord[] = []
  approvals = new Map<string, { status: 'pending' | 'approved' | 'rejected'; title: string; context: unknown }>()
  lostLease = false
  async claimRuns(): Promise<RunRow[]> { return [] }
  async sweepTimeouts() { return 0 }
  async loadDefinition(_versionId?: string) { return this.definition }
  async countStepRuns() { return this.steps.length }
  async insertStepRun(r: StepRecord) { this.steps.push(r) }
  async getApproval(runId: string, key: string) { return this.approvals.get(`${runId}:${key}`) ?? null }
  async createApproval(a: { runId: string; stepKey: string; title: string; context: unknown }) {
    const k = `${a.runId}:${a.stepKey}`
    if (this.approvals.has(k)) throw new Error('duplicate approval')
    this.approvals.set(k, { status: 'pending', title: a.title, context: a.context })
  }
  async saveRun(_id: string, patch: RunPatch) {
    if (this.lostLease) return false
    Object.assign(this.run, patch)
    if (patch.context) this.run.context = patch.context
    return true
  }
}

function makeRun(over: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run1', organization_id: 'org1', workflow_id: 'wf1', version_id: 'v1', attempt: 1, step_attempt: 0,
    current_step_key: null, deadline_at: new Date(T0.getTime() + 15 * 60_000).toISOString(),
    context: { order: { external_id: '1001', total_minor: 25000, customer_email: 'ana@example.com' }, event: { type: 'order.created' } },
    ...over,
  }
}

const def = (steps: unknown[]) => ({ schema_version: 1, trigger: { type: 'order_created' }, steps })
const http = (id: string, next: string | null, over = {}) => ({ id, name: id, type: 'http_request', method: 'POST', url: 'https://api.example.com/hook?token=abc', next, ...over })
const done = (id: string, result = 'succeeded', message = '') => ({ id, name: id, type: 'record_result', result, message })

let store: FakeStore
let clock = T0
let calls: { method: string; url: string }[]
let responses: (() => { status: number; body: string } | Error)[]
const client: HttpClient = {
  async request(req) {
    calls.push({ method: req.method, url: req.url })
    const r = (responses.shift() ?? (() => ({ status: 200, body: '{"ok":true}' })))()
    if (r instanceof Error) throw r
    return r
  },
}
const deps = () => ({ store, http: client, log, now: () => clock })
const run = async (over: Partial<RunRow> = {}) => {
  store.run = { ...makeRun(over), status: 'running' }
  await processRun(store.run, deps())
  return store.run
}

beforeEach(() => {
  store = new FakeStore()
  clock = T0
  calls = []
  responses = []
})

describe('step execution', () => {
  it('runs a linear workflow to success and records each step', async () => {
    store.definition = def([http('call', 'done'), done('done')])
    const r = await run()
    expect(r.status).toBe('succeeded')
    expect(store.steps.map((s) => [s.stepKey, s.status])).toEqual([['call', 'succeeded'], ['done', 'succeeded']])
    expect(store.steps[0].position).toBe(0)
    expect(store.steps[1].position).toBe(1)
  })

  it('branches on a condition using the trigger context', async () => {
    const steps = (op: string) => [
      { id: 'check', name: 'check', type: 'condition', field: 'order.total_minor', operator: op, value: 10000, on_true: 'big', on_false: 'small' },
      done('big', 'succeeded', 'big'), done('small', 'succeeded', 'small'),
    ]
    store.definition = def(steps('gt'))
    await run()
    expect(store.steps.map((s) => s.stepKey)).toEqual(['check', 'big'])

    store = new FakeStore()
    store.definition = def(steps('lt'))
    await run()
    expect(store.steps.map((s) => s.stepKey)).toEqual(['check', 'small'])
  })

  it('makes earlier step outputs available to later conditions', async () => {
    store.definition = def([
      http('call', 'check'),
      { id: 'check', name: 'check', type: 'condition', field: 'steps.call.status', operator: 'eq', value: 200, on_true: 'ok', on_false: null },
      done('ok'),
    ])
    responses = [() => ({ status: 200, body: '{}' })]
    await run()
    expect(store.steps.map((s) => s.stepKey)).toEqual(['call', 'check', 'ok'])
  })

  it('ends a run whose last step has no continuation as succeeded', async () => {
    store.definition = def([http('only', null)])
    expect((await run()).status).toBe('succeeded')
  })

  it('records an explicit failed result and fails the run', async () => {
    store.definition = def([done('stop', 'failed', 'Fraud suspected')])
    const r = await run()
    expect(r.status).toBe('failed')
    expect(r.error).toBe('Fraud suspected')
    expect(store.steps[0].status).toBe('failed')
  })

  it('refuses to execute an invalid or now-unavailable definition', async () => {
    store.definition = def([{ id: 'mail', name: 'mail', type: 'send_email', to: 'a@b.co', subject: 's', body: 'b', next: null }])
    const r = await run()
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(/invalid/i)
    expect(store.steps).toHaveLength(0)
  })
})

describe('retries and failures', () => {
  it('schedules a bounded retry with backoff on 5xx, then succeeds', async () => {
    store.definition = def([http('call', null)])
    responses = [() => ({ status: 503, body: '' })]
    let r = await run()
    expect(r.status).toBe('pending')
    expect(r.current_step_key).toBe('call')
    expect(r.step_attempt).toBe(1)
    expect(new Date(r.next_run_at!).getTime()).toBe(T0.getTime() + 30_000)
    expect(store.steps[0]).toMatchObject({ status: 'failed', attempt: 1 })

    clock = new Date(T0.getTime() + 31_000)
    r = await run({ current_step_key: 'call', step_attempt: 1 })
    expect(r.status).toBe('succeeded')
    expect(store.steps.at(-1)).toMatchObject({ status: 'succeeded', attempt: 2 })
  })

  it('treats network errors as retryable and gives up after the attempt limit', async () => {
    store.definition = def([http('call', null)])
    responses = [() => new HttpError('timeout', true), () => new HttpError('timeout', true), () => new HttpError('timeout', true)]
    let r = await run()
    r = await run({ current_step_key: 'call', step_attempt: 1 })
    expect(r.status).toBe('pending')
    expect(new Date(r.next_run_at!).getTime()).toBe(T0.getTime() + 120_000)
    r = await run({ current_step_key: 'call', step_attempt: 2 })
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(new RegExp(`after ${MAX_STEP_ATTEMPTS} attempts`))
    expect(calls).toHaveLength(3)
  })

  it('does not retry client errors', async () => {
    store.definition = def([http('call', null)])
    responses = [() => ({ status: 404, body: 'nope' })]
    const r = await run()
    expect(r.status).toBe('failed')
    expect(calls).toHaveLength(1)
  })

  it('blocks internal destinations without making a request', async () => {
    store.definition = def([http('call', null, { url: 'https://169.254.169.254/latest/meta-data' })])
    const r = await run()
    expect(r.status).toBe('failed')
    expect(calls).toHaveLength(0)
  })

  it('fails runs past their deadline instead of executing more steps', async () => {
    store.definition = def([http('call', null)])
    const r = await run({ deadline_at: new Date(T0.getTime() - 1000).toISOString() })
    expect(r.status).toBe('failed')
    expect(r.error).toBe('Execution timed out')
    expect(calls).toHaveLength(0)
  })

  it('yields after the per-tick step budget and resumes where it stopped', async () => {
    const steps = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `s${i}`, type: 'condition', field: 'order.external_id', operator: 'exists', value: null, on_true: i < 24 ? `s${i + 1}` : null, on_false: null }))
    store.definition = def(steps)
    let r = await run()
    expect(r.status).toBe('pending')
    expect(r.current_step_key).toBe('s20')
    r = await run({ current_step_key: 's20' })
    expect(r.status).toBe('succeeded')
  })

  it('does not overwrite a run it no longer owns', async () => {
    store.definition = def([http('call', null)])
    store.lostLease = true
    store.run = { ...makeRun(), status: 'failed' }
    await processRun(store.run, deps())
    expect(store.run.status).toBe('failed')
  })
})

describe('approvals', () => {
  const approvalFlow = () => def([
    { id: 'ask', name: 'ask', type: 'create_approval', title: 'Approve big order', reviewer_role: 'admin', next: 'after' },
    http('after', 'done'), done('done'),
  ])

  it('pauses at an approval step, persists the request, and makes no further progress', async () => {
    store.definition = approvalFlow()
    const r = await run()
    expect(r.status).toBe('waiting_approval')
    expect(r.current_step_key).toBe('ask')
    expect(store.approvals.get('run1:ask')?.title).toBe('Approve big order')
    expect(calls).toHaveLength(0)
  })

  it('resumes after approval and completes', async () => {
    store.definition = approvalFlow()
    await run()
    store.approvals.get('run1:ask')!.status = 'approved'
    const r = await run({ current_step_key: 'ask' })
    expect(r.status).toBe('succeeded')
    expect(calls).toHaveLength(1)
    expect(store.approvals.size).toBe(1) // no duplicate request on resume
  })

  it('fails the run when the approval is rejected', async () => {
    store.definition = approvalFlow()
    await run()
    store.approvals.get('run1:ask')!.status = 'rejected'
    const r = await run({ current_step_key: 'ask' })
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(/rejected/i)
    expect(calls).toHaveLength(0)
  })

  it('stays waiting if resumed while the decision is still pending', async () => {
    store.definition = approvalFlow()
    await run()
    expect((await run({ current_step_key: 'ask' })).status).toBe('waiting_approval')
  })

  it('strips personal details and secrets from the approval context stored for reviewers', async () => {
    store.definition = approvalFlow()
    await run({ context: { order: { external_id: '1', api_key: 'sk-live-123' }, event: { type: 'x' } } })
    expect(JSON.stringify(store.approvals.get('run1:ask')?.context)).not.toContain('sk-live-123')
  })
})

describe('redaction', () => {
  it('masks sensitive keys and URL query strings in persisted step data', async () => {
    store.definition = def([http('call', null, { body: '{"x":1}' })])
    responses = [() => ({ status: 200, body: '{"token":"abc"}' })]
    await run()
    expect(store.steps[0].input).toMatchObject({ url: 'https://api.example.com/[redacted]' })
    expect(JSON.stringify(store.steps[0].input)).not.toContain('abc')
  })

  it('redacts nested credentials and truncates long strings', () => {
    const out = redact({ headers: { Authorization: 'Bearer x', 'x-api-key': 'k' }, nested: [{ password: 'p', ok: 1 }], big: 'a'.repeat(5000) }) as any
    expect(out.headers.Authorization).toBe('[redacted]')
    expect(out.headers['x-api-key']).toBe('[redacted]')
    expect(out.nested[0]).toEqual({ password: '[redacted]', ok: 1 })
    expect(out.big.length).toBeLessThan(2100)
    expect(redactUrl('https://a.com/p?secret=1')).toBe('https://a.com/[redacted]')
    expect(redactUrl('https://discord.com/api/webhooks/1/abcSECRET')).toBe('https://discord.com/[redacted]')
    expect(redactUrl('https://a.com')).toBe('https://a.com')
  })
})

describe('tick', () => {
  it('processes claimed runs, isolates crashes, and reports counts', async () => {
    const good = { ...makeRun({ id: 'good' }) }
    const bad = { ...makeRun({ id: 'bad' }) }
    store.definition = def([done('d')])
    store.claimRuns = async () => [bad, good]
    store.sweepTimeouts = async () => 2
    const seen: string[] = []
    const original = store.loadDefinition.bind(store)
    store.loadDefinition = async (v: string) => {
      if (seen.push(v) === 1) throw new Error('db down')
      return original()
    }
    store.run = { ...good, status: 'running' }
    const result = await tick(deps())
    expect(result).toEqual({ claimed: 2, timedOut: 2 })
    expect(store.run.status).toBe('succeeded') // second run still processed
  })
})
