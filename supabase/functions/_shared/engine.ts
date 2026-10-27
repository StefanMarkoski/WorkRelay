import { evaluateCondition } from './conditions.ts'
import type { Logger } from './log.ts'
import { redact, redactUrl } from './redact.ts'
import { checkOutboundUrl } from './ssrf.ts'
import { validateDefinition, type WorkflowDefinition, type WorkflowStep } from './workflow-schema.ts'

export type RunStatus = 'pending' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'skipped'

export interface RunRow {
  id: string
  organization_id: string
  workflow_id: string
  version_id: string
  attempt: number
  step_attempt: number
  current_step_key: string | null
  context: Record<string, unknown>
  deadline_at: string | null
}

export interface StepRecord {
  organizationId: string
  runId: string
  stepKey: string
  stepName: string
  stepType: string
  position: number
  status: RunStatus
  input: unknown
  output: unknown
  error: string | null
  attempt: number
  startedAt: string
  finishedAt: string
}

export type RunPatch = Partial<{
  status: RunStatus
  error: string | null
  current_step_key: string | null
  step_attempt: number
  next_run_at: string
  finished_at: string
  context: Record<string, unknown>
}>

export interface EngineStore {
  claimRuns(limit: number, leaseSeconds: number): Promise<RunRow[]>
  sweepTimeouts(): Promise<number>
  loadDefinition(versionId: string): Promise<unknown>
  countStepRuns(runId: string): Promise<number>
  insertStepRun(rec: StepRecord): Promise<void>
  getApproval(runId: string, stepKey: string): Promise<{ status: 'pending' | 'approved' | 'rejected' } | null>
  createApproval(a: { organizationId: string; runId: string; stepKey: string; title: string; reviewerRole: string; context: unknown }): Promise<void>
  /** Applies only while the run is still leased (status 'running'); returns false if it lost the run (e.g. timeout sweep). */
  saveRun(runId: string, patch: RunPatch): Promise<boolean>
}

export class HttpError extends Error {
  retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

export interface HttpClient {
  /** Must throw HttpError(retryable) on network failure or blocked destinations. Never follows redirects. */
  request(req: { method: string; url: string; body?: string }): Promise<{ status: number; body: string }>
}

export interface EngineDeps {
  store: EngineStore
  http: HttpClient
  log: Logger
  now?: () => Date
}

export const MAX_STEP_ATTEMPTS = 3
export const RETRY_DELAYS_SECONDS = [30, 120]
const MAX_STEPS_PER_CLAIM = 20

type Outcome =
  | { kind: 'next'; next: string | null; output: unknown }
  | { kind: 'finish'; status: 'succeeded' | 'failed'; output: unknown; error?: string }
  | { kind: 'wait_approval'; output: unknown }
  | { kind: 'retry'; error: string }
  | { kind: 'fail'; error: string; output?: unknown }

export async function processRun(run: RunRow, deps: EngineDeps): Promise<void> {
  const { store, log } = deps
  const now = () => (deps.now ? deps.now() : new Date())
  const fail = (error: string) => store.saveRun(run.id, { status: 'failed', error, finished_at: now().toISOString() })

  const raw = await store.loadDefinition(run.version_id)
  const validated = validateDefinition(raw)
  // A definition that fails validation here (e.g. an action that became unavailable) must not execute.
  if (!validated.ok) {
    await fail(`Workflow definition is invalid: ${validated.issues[0]?.message ?? 'unknown issue'}`)
    return
  }
  const def: WorkflowDefinition = validated.value
  const byId = new Map(def.steps.map((s) => [s.id, s]))

  let ctx = run.context
  let stepKey: string = run.current_step_key ?? def.steps[0].id
  let stepAttempt = run.step_attempt
  let position = await store.countStepRuns(run.id)

  for (let executed = 0; executed < MAX_STEPS_PER_CLAIM; executed++) {
    if (run.deadline_at && now() > new Date(run.deadline_at)) {
      await fail('Execution timed out')
      return
    }
    const step = byId.get(stepKey)
    if (!step) {
      await fail(`Unknown step "${stepKey}"`)
      return
    }

    const startedAt = now().toISOString()
    stepAttempt += 1
    const { outcome, input } = await executeStep(step, run, ctx, deps)
    const record = (status: RunStatus, output: unknown, error: string | null) =>
      store.insertStepRun({
        organizationId: run.organization_id, runId: run.id, stepKey: step.id, stepName: step.name, stepType: step.type,
        position: position++, status, input: redact(input), output: redact(output), error, attempt: stepAttempt,
        startedAt, finishedAt: now().toISOString(),
      })

    switch (outcome.kind) {
      case 'next': {
        await record('succeeded', outcome.output, null)
        ctx = { ...ctx, steps: { ...((ctx.steps as object) ?? {}), [step.id]: redact(outcome.output) } }
        if (outcome.next === null) {
          await store.saveRun(run.id, { status: 'succeeded', finished_at: now().toISOString(), context: ctx, current_step_key: null })
          return
        }
        stepKey = outcome.next
        stepAttempt = 0
        break
      }
      case 'finish': {
        await record(outcome.status === 'succeeded' ? 'succeeded' : 'failed', outcome.output, outcome.error ?? null)
        await store.saveRun(run.id, { status: outcome.status, error: outcome.error ?? null, finished_at: now().toISOString(), context: ctx })
        return
      }
      case 'wait_approval': {
        await record('waiting_approval', outcome.output, null)
        await store.saveRun(run.id, { status: 'waiting_approval', current_step_key: step.id, step_attempt: 0, context: ctx })
        return
      }
      case 'retry': {
        await record('failed', null, `${outcome.error} (attempt ${stepAttempt} of ${MAX_STEP_ATTEMPTS})`)
        if (stepAttempt >= MAX_STEP_ATTEMPTS) {
          await fail(`Step "${step.name}" failed after ${stepAttempt} attempts: ${outcome.error}`)
          return
        }
        const delay = RETRY_DELAYS_SECONDS[Math.min(stepAttempt - 1, RETRY_DELAYS_SECONDS.length - 1)]
        await store.saveRun(run.id, {
          status: 'pending', current_step_key: step.id, step_attempt: stepAttempt,
          next_run_at: new Date(now().getTime() + delay * 1000).toISOString(), context: ctx,
        })
        log.info('step scheduled for retry', { run_id: run.id, step: step.id, delay_seconds: delay })
        return
      }
      case 'fail': {
        await record('failed', outcome.output ?? null, outcome.error)
        await fail(`Step "${step.name}" failed: ${outcome.error}`)
        return
      }
    }
  }
  // Step budget for this tick used up: yield the lease and continue on the next tick.
  await store.saveRun(run.id, { status: 'pending', current_step_key: stepKey, step_attempt: stepAttempt, next_run_at: now().toISOString(), context: ctx })
}

async function executeStep(
  step: WorkflowStep,
  run: RunRow,
  ctx: Record<string, unknown>,
  deps: EngineDeps,
): Promise<{ outcome: Outcome; input: unknown }> {
  switch (step.type) {
    case 'condition': {
      const result = evaluateCondition(ctx, step.field, step.operator, step.value)
      return {
        input: { field: step.field, operator: step.operator, value: step.value },
        outcome: { kind: 'next', next: result ? step.on_true : step.on_false, output: { result } },
      }
    }

    case 'http_request': {
      const input = { method: step.method, url: redactUrl(step.url), body: step.body }
      const blocked = checkOutboundUrl(step.url)
      if (blocked) return { input, outcome: { kind: 'fail', error: `Destination blocked: ${blocked}` } }
      try {
        const res = await deps.http.request({ method: step.method, url: step.url, body: step.body })
        const output = { status: res.status, body: res.body }
        if (res.status >= 200 && res.status < 300) return { input, outcome: { kind: 'next', next: step.next, output } }
        if (res.status === 429 || res.status >= 500) return { input, outcome: { kind: 'retry', error: `HTTP ${res.status}` } }
        return { input, outcome: { kind: 'fail', error: `HTTP ${res.status}`, output } }
      } catch (err) {
        const retryable = err instanceof HttpError ? err.retryable : true
        const message = err instanceof Error ? err.message : 'request failed'
        return { input, outcome: retryable ? { kind: 'retry', error: message } : { kind: 'fail', error: message } }
      }
    }

    case 'create_approval': {
      const existing = await deps.store.getApproval(run.id, step.id)
      if (!existing) {
        await deps.store.createApproval({
          organizationId: run.organization_id, runId: run.id, stepKey: step.id, title: step.title,
          reviewerRole: step.reviewer_role, context: redact({ order: ctx.order, event: ctx.event }),
        })
        return { input: { title: step.title, reviewer_role: step.reviewer_role }, outcome: { kind: 'wait_approval', output: { status: 'pending' } } }
      }
      const input = { title: step.title }
      if (existing.status === 'pending') return { input, outcome: { kind: 'wait_approval', output: { status: 'pending' } } }
      if (existing.status === 'approved') return { input, outcome: { kind: 'next', next: step.next, output: { decision: 'approved' } } }
      return { input, outcome: { kind: 'fail', error: 'Approval was rejected', output: { decision: 'rejected' } } }
    }

    case 'record_result':
      return {
        input: { result: step.result },
        outcome: {
          kind: 'finish', status: step.result, output: { message: step.message ?? null },
          error: step.result === 'failed' ? (step.message || 'Recorded as failed by the workflow') : undefined,
        },
      }

    case 'send_email':
      return { input: { to: step.to, subject: step.subject }, outcome: { kind: 'fail', error: 'Email delivery is unavailable: no provider configured' } }
  }
}

export interface TickResult {
  claimed: number
  timedOut: number
}

/** One bounded unit of work: sweep timeouts, claim a batch, process each claimed run. */
export async function tick(deps: EngineDeps, opts = { batch: 10, leaseSeconds: 60 }): Promise<TickResult> {
  const timedOut = await deps.store.sweepTimeouts()
  const runs = await deps.store.claimRuns(opts.batch, opts.leaseSeconds)
  for (const run of runs) {
    try {
      await processRun(run, deps)
    } catch (err) {
      // The lease expires and the run is re-claimed; the failure is visible in logs, never a silent loss.
      deps.log.error('run processing crashed', { run_id: run.id, message: err instanceof Error ? err.message : 'unknown' })
    }
  }
  return { claimed: runs.length, timedOut }
}
