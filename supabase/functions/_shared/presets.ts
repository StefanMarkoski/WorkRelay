import { z } from 'zod'
import { checkOutboundUrl } from './ssrf.ts'
import type { WorkflowDefinition } from './workflow-schema.ts'

/** Ready-made automations. Each preset is turned into a normal workflow definition, so the engine, retries,
 *  approvals and execution history work exactly the same as for any workflow. */

export const NOTIFY_EVENTS = ['created', 'cancelled', 'status_changed', 'customer_signed_up', 'customer_first_order'] as const
export const NOTIFY_CHANNELS = ['discord', 'slack', 'generic'] as const

const safeUrl = z.string().trim().max(2000).superRefine((value, ctx) => {
  const problem = checkOutboundUrl(value)
  if (problem) ctx.addIssue({ code: 'custom', message: problem })
})

export const notifyConfigSchema = z.object({
  event: z.enum(NOTIFY_EVENTS),
  channel: z.enum(NOTIFY_CHANNELS),
  url: safeUrl,
  /** Limit it to these shops. Left out: all shops (including ones connected later). */
  integration_ids: z.array(z.uuid()).min(1, 'Pick at least one shop').max(50).optional(),
  /** Older form of the above for the signup event (one shop). Still accepted. */
  integration_id: z.uuid().optional(),
})

export const reviewLargeConfigSchema = z.object({
  threshold: z.number().positive('Enter an amount above 0').max(100_000_000),
  reviewer_role: z.enum(['admin', 'owner']),
  integration_ids: z.array(z.uuid()).min(1, 'Pick at least one shop').max(50).optional(),
})

export type NotifyConfig = z.infer<typeof notifyConfigSchema>
export type ReviewLargeConfig = z.infer<typeof reviewLargeConfigSchema>
export type PresetKind = 'notify' | 'review_large'

export const EVENT_LABELS: Record<NotifyConfig['event'], string> = {
  created: 'a new order arrives',
  cancelled: 'an order is cancelled',
  status_changed: 'an order changes status',
  customer_signed_up: 'a customer signs up',
  customer_first_order: 'a new customer places their first order',
}
export const CHANNEL_LABELS: Record<NotifyConfig['channel'], string> = { discord: 'Discord', slack: 'Slack', generic: 'a webhook URL' }

const MESSAGES: Record<NotifyConfig['event'], string> = {
  created: 'New order {{order.display_number}} from {{order.customer}}: {{order.total}}',
  cancelled: 'Order {{order.display_number}} was cancelled ({{order.total}})',
  status_changed: 'Order {{order.display_number}} is now {{order.status}} ({{order.total}})',
  customer_signed_up: 'New customer signed up: {{customer.display_name}} ({{customer.email}})',
  customer_first_order: 'New customer {{customer.display_name}} ({{customer.email}}) placed their first order: {{order.display_number}}, {{order.total}}',
}

/** Placeholders sit inside JSON string literals; the engine escapes their values. */
export function notifyBody(config: NotifyConfig): string {
  const text = MESSAGES[config.event]
  if (config.channel === 'discord') return `{"content":"${text}"}`
  if (config.channel === 'slack') return `{"text":"${text}"}`
  if (config.event === 'customer_signed_up') {
    return `{"event":"customer.signed_up","customer":"{{customer.display_name}}","email":"{{customer.email}}","phone":"{{customer.phone}}","external_id":"{{customer.external_id}}","message":"${text}"}`
  }
  if (config.event === 'customer_first_order') {
    return `{"event":"customer.first_order","customer":"{{customer.display_name}}","email":"{{customer.email}}","order_number":"{{order.display_number}}","total":"{{order.total}}","currency":"{{order.currency}}","message":"${text}"}`
  }
  return `{"event":"order.${config.event}","order_number":"{{order.display_number}}","status":"{{order.status}}","payment_status":"{{order.payment_status}}","fulfillment_status":"{{order.fulfillment_status}}","customer":"{{order.customer}}","total":"{{order.total}}","currency":"{{order.currency}}","message":"${text}"}`
}

/** The shops an automation is limited to, or undefined for all shops. The older single `integration_id` counts as a list of one. */
export function shopIds(config: { integration_ids?: string[]; integration_id?: string }): string[] | undefined {
  if (config.integration_ids?.length) return config.integration_ids
  return config.integration_id ? [config.integration_id] : undefined
}

export function buildNotifyDefinition(config: NotifyConfig): WorkflowDefinition {
  const ids = shopIds(config)
  const limit = ids ? { integration_ids: ids } : {}
  const trigger: WorkflowDefinition['trigger'] =
    config.event === 'customer_signed_up' ? { type: 'customer_signup', ...limit }
    : config.event === 'customer_first_order' ? { type: 'customer_first_order', ...limit }
    : config.event === 'created' ? { type: 'order_created', ...limit }
    : config.event === 'cancelled' ? { type: 'order_status_changed', to_status: 'cancelled', ...limit }
    : { type: 'order_status_changed', ...limit }
  return {
    schema_version: 1,
    trigger,
    steps: [
      { id: 'notify', name: `Notify ${CHANNEL_LABELS[config.channel]}`, type: 'http_request', method: 'POST', url: config.url, body: notifyBody(config), next: 'done' },
      { id: 'done', name: 'Done', type: 'record_result', result: 'succeeded', message: 'Notification sent' },
    ],
  }
}

export function buildReviewLargeDefinition(config: ReviewLargeConfig): WorkflowDefinition {
  return {
    schema_version: 1,
    trigger: { type: 'order_created', ...(config.integration_ids?.length ? { integration_ids: config.integration_ids } : {}) },
    steps: [
      // The threshold is entered in major units (e.g. 100 = 100.00); totals are stored in minor units.
      { id: 'check', name: 'Is the order large?', type: 'condition', field: 'order.total_minor', operator: 'gt', value: Math.round(config.threshold * 100), on_true: 'review', on_false: null },
      { id: 'review', name: 'Ask for review', type: 'create_approval', title: 'Review large order {{order.display_number}} ({{order.total}})', reviewer_role: config.reviewer_role, next: 'done' },
      { id: 'done', name: 'Done', type: 'record_result', result: 'succeeded', message: 'Reviewed' },
    ],
  }
}

export function buildPresetDefinition(kind: PresetKind, config: unknown): { ok: true; definition: WorkflowDefinition } | { ok: false; issues: string[] } {
  const schema = kind === 'notify' ? notifyConfigSchema : reviewLargeConfigSchema
  const parsed = schema.safeParse(config)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) }
  return {
    ok: true,
    definition: kind === 'notify' ? buildNotifyDefinition(parsed.data as NotifyConfig) : buildReviewLargeDefinition(parsed.data as ReviewLargeConfig),
  }
}

/** Short human description of a saved preset, for lists. Never includes the full destination URL. */
export function describePreset(kind: PresetKind, config: Record<string, any>): { title: string; summary: string } {
  if (kind === 'notify') {
    let host = 'the destination'
    try { host = new URL(String(config.url)).hostname } catch { /* keep default */ }
    return {
      title: `Notify ${CHANNEL_LABELS[config.channel as NotifyConfig['channel']] ?? 'webhook'} when ${EVENT_LABELS[config.event as NotifyConfig['event']] ?? 'an event happens'}`,
      summary: `Posts a message to ${host}`,
    }
  }
  return {
    title: `Review orders above ${config.threshold}`,
    summary: `Creates an approval task for ${config.reviewer_role === 'owner' ? 'owners' : 'owners and admins'}`,
  }
}
