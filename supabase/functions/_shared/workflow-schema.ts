import { z } from 'zod'
import { checkOutboundUrl } from './ssrf.ts'

/** UI-independent workflow representation. A visual canvas can later read and write the same shape. */

export const TRIGGER_TYPES = ['webhook', 'order_created', 'order_status_changed', 'customer_signup', 'customer_first_order', 'low_stock', 'products_synced', 'manual'] as const
export const STEP_TYPES = ['condition', 'http_request', 'send_email', 'create_approval', 'record_result'] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]
export type StepType = (typeof STEP_TYPES)[number]

const stepId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use lowercase letters, digits and underscores')
const ref = stepId.nullable()
const base = { id: stepId, name: z.string().min(1).max(120) }

/** Limit a trigger to some shops. Left out: all shops, including ones connected later. */
const shops = z.array(z.uuid()).min(1, 'Pick at least one shop').max(50).optional()

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('webhook'), integration_id: z.uuid() }),
  z.object({ type: z.literal('order_created'), integration_ids: shops }),
  z.object({ type: z.literal('order_status_changed'), to_status: z.string().min(1).max(64).optional(), integration_ids: shops }),
  // Needs signups switched on for the shops it covers (checked when publishing).
  // `integration_id` (one shop) is the older form and still works.
  z.object({ type: z.literal('customer_signup'), integration_id: z.uuid().optional(), integration_ids: shops }),
  z.object({ type: z.literal('customer_first_order'), integration_ids: shops }),
  // Fires once each time a product reaches its "Notify on" number (see migration 0015). With include_estimates it also fires when the
  // estimated stock (last report minus the orders since) crosses it, for shops that estimate (migration 0033).
  z.object({ type: z.literal('low_stock'), integration_ids: shops, include_estimates: z.boolean().optional() }),
  // Fires when a shop pushes its products to WorkRelay (see migration 0021). Scheduled pulls and Sync now do not.
  z.object({ type: z.literal('products_synced'), integration_ids: shops }),
  z.object({ type: z.literal('manual') }),
])

export const stepSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('condition'),
    field: z.string().min(1).max(200),
    operator: z.enum(['eq', 'neq', 'gt', 'lt', 'contains', 'exists']),
    value: z.union([z.string().max(500), z.number(), z.boolean()]).nullable(),
    on_true: ref,
    on_false: ref,
  }),
  z.object({
    ...base,
    type: z.literal('http_request'),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: z.string().min(1).max(2000),
    body: z.string().max(20000).optional(),
    next: ref,
  }),
  z.object({
    ...base,
    type: z.literal('send_email'),
    to: z.email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(10000),
    next: ref,
  }),
  z.object({
    ...base,
    type: z.literal('create_approval'),
    title: z.string().min(1).max(200),
    reviewer_role: z.enum(['owner', 'admin', 'member']),
    next: ref,
  }),
  z.object({
    ...base,
    type: z.literal('record_result'),
    result: z.enum(['succeeded', 'failed']),
    message: z.string().max(500).optional(),
  }),
])

export const workflowDefinitionSchema = z.object({
  schema_version: z.literal(1),
  trigger: triggerSchema,
  steps: z.array(stepSchema).min(1, 'Add at least one step').max(50),
})

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>
export type WorkflowStep = z.infer<typeof stepSchema>
export type WorkflowTrigger = z.infer<typeof triggerSchema>

export interface ValidationIssue {
  path: string
  message: string
}

/** Action types that the execution layer can actually run. Email needs a provider integration that does not exist yet. */
export const UNAVAILABLE_STEP_TYPES: Partial<Record<StepType, string>> = {
  send_email: 'No email provider is configured, so this action is unavailable',
}

export function emptyDefinition(): Partial<WorkflowDefinition> {
  return { schema_version: 1, steps: [] }
}

export function stepTargets(s: WorkflowStep): (string | null)[] {
  if (s.type === 'condition') return [s.on_true, s.on_false]
  if (s.type === 'record_result') return []
  return [s.next]
}

export function validateDefinition(
  input: unknown,
): { ok: true; value: WorkflowDefinition } | { ok: false; issues: ValidationIssue[] } {
  const parsed = workflowDefinitionSchema.safeParse(input)
  const issues: ValidationIssue[] = []
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 30)) {
      issues.push({ path: i.path.join('.') || '(root)', message: i.message })
    }
    return { ok: false, issues }
  }
  const def = parsed.data
  const ids = new Set<string>()
  def.steps.forEach((s, idx) => {
    const p = `steps.${idx}`
    if (ids.has(s.id)) issues.push({ path: `${p}.id`, message: `Duplicate step id "${s.id}"` })
    ids.add(s.id)
    const unavailable = UNAVAILABLE_STEP_TYPES[s.type]
    if (unavailable) issues.push({ path: p, message: unavailable })
    if (s.type === 'http_request') {
      const problem = checkOutboundUrl(s.url)
      if (problem) issues.push({ path: `${p}.url`, message: problem })
    }
  })
  def.steps.forEach((s, idx) => {
    for (const t of stepTargets(s)) {
      if (t && !ids.has(t)) issues.push({ path: `steps.${idx}`, message: `References unknown step "${t}"` })
      if (t === s.id) issues.push({ path: `steps.${idx}`, message: 'A step cannot continue to itself' })
    }
  })
  if (issues.length === 0) {
    const byId = new Map(def.steps.map((s) => [s.id, s]))
    const state = new Map<string, 1 | 2>()
    const visit = (id: string): boolean => {
      if (state.get(id) === 2) return false
      if (state.get(id) === 1) return true
      state.set(id, 1)
      for (const t of stepTargets(byId.get(id)!)) if (t && visit(t)) return true
      state.set(id, 2)
      return false
    }
    // The first step is the entry point.
    if (visit(def.steps[0].id)) issues.push({ path: 'steps', message: 'Steps form a loop' })
    else {
      for (const [idx, s] of def.steps.entries()) {
        if (!state.has(s.id)) issues.push({ path: `steps.${idx}`, message: `"${s.name}" is unreachable from the first step` })
      }
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: def }
}
