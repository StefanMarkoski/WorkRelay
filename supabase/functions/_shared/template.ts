import { getPath } from './conditions.ts'

/** How many decimals the currency's minor unit has (2 for EUR, 0 for JPY, 3 for KWD). */
function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** Adds human-friendly fields to the run context for use in messages. Raw fields stay available. */
export function templateView(ctx: Record<string, unknown>): Record<string, unknown> {
  const order = { ...((ctx.order as Record<string, unknown> | undefined) ?? {}) }
  const num = order.order_number as string | null | undefined
  const ext = order.external_id as string | null | undefined
  const total = order.total_minor as number | null | undefined
  const currency = order.currency as string | null | undefined
  order.display_number = num || (ext ? `#${ext}` : 'order')
  order.customer = (order.customer_name as string | null) || (order.customer_email as string | null) || 'unknown customer'
  const digits = currency ? minorDigits(currency) : 2
  order.total = total == null ? 'no total' : `${(total / 10 ** digits).toFixed(digits)}${currency ? ` ${currency}` : ''}`
  const out: Record<string, unknown> = { ...ctx, order }
  if (ctx.customer && typeof ctx.customer === 'object') {
    const c = { ...(ctx.customer as Record<string, unknown>) }
    c.display_name = (c.name as string | null) || (c.email as string | null) || 'a customer'
    out.customer = c
  }
  return out
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g

/**
 * Replaces {{path}} with values from the view. With `json: true` the value is escaped for use inside a JSON string
 * literal (so placeholders must sit inside quotes), which keeps customer-controlled text from breaking the payload.
 * Missing values become an empty string.
 */
export function renderTemplate(template: string, view: Record<string, unknown>, opts: { json?: boolean } = {}): string {
  return template.replace(PLACEHOLDER, (_m, path: string) => {
    const value = getPath(view, path)
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    return opts.json ? JSON.stringify(text).slice(1, -1) : text
  })
}
