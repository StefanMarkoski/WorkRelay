import { STEP_TYPES, UNAVAILABLE_STEP_TYPES, type StepType, type TriggerType } from '@/domain/workflows'

/** Editable shape: may be incomplete. The zod schema decides whether it can be published. */
export interface DraftStep {
  id: string
  name: string
  type: StepType
  [key: string]: unknown
}

export interface DraftDefinition {
  schema_version: 1
  trigger: { type: TriggerType; integration_id?: string; to_status?: string } | null
  steps: DraftStep[]
}

export const STEP_LABELS: Record<StepType, string> = {
  condition: 'Evaluate a condition',
  http_request: 'Send an HTTP request',
  send_email: 'Send an email',
  create_approval: 'Create an approval request',
  record_result: 'Record an execution result',
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  webhook: 'Incoming webhook',
  order_created: 'Order created',
  order_status_changed: 'Order status changed',
  manual: 'Manual execution (testing)',
}

export const availableStepTypes = STEP_TYPES.filter((t) => !UNAVAILABLE_STEP_TYPES[t])

export function normalizeDraft(raw: unknown): DraftDefinition {
  const d = (raw ?? {}) as Partial<DraftDefinition>
  return {
    schema_version: 1,
    trigger: d.trigger ?? null,
    steps: Array.isArray(d.steps) ? d.steps : [],
  }
}

const DEFAULTS: Record<StepType, Record<string, unknown>> = {
  condition: { field: '', operator: 'eq', value: '', on_true: null, on_false: null },
  http_request: { method: 'POST', url: '', body: '', next: null },
  send_email: { to: '', subject: '', body: '', next: null },
  create_approval: { title: '', reviewer_role: 'admin', next: null },
  record_result: { result: 'succeeded', message: '' },
}

export function newStep(type: StepType, existing: DraftStep[]): DraftStep {
  let n = existing.length + 1
  while (existing.some((s) => s.id === `${type}_${n}`)) n++
  return { id: `${type}_${n}`, name: STEP_LABELS[type], type, ...DEFAULTS[type] }
}

/** Appending to a linear flow wires the previous tail to the new step. */
export function appendStep(def: DraftDefinition, step: DraftStep): DraftDefinition {
  const steps = def.steps.map((s, i) =>
    i === def.steps.length - 1 && 'next' in s && s.next === null ? { ...s, next: step.id } : s,
  )
  return { ...def, steps: [...steps, step] }
}

export function removeStep(def: DraftDefinition, id: string): DraftDefinition {
  const clean = (v: unknown) => (v === id ? null : v)
  return {
    ...def,
    steps: def.steps
      .filter((s) => s.id !== id)
      .map((s) => ({ ...s, ...('next' in s ? { next: clean(s.next) } : {}), ...(s.type === 'condition' ? { on_true: clean(s.on_true), on_false: clean(s.on_false) } : {}) })),
  }
}

export function toStored(def: DraftDefinition) {
  return { schema_version: 1, ...(def.trigger ? { trigger: def.trigger } : {}), steps: def.steps }
}
