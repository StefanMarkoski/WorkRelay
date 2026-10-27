const SENSITIVE_KEY = /(^|[-_])(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|apikey|credential)s?($|[-_])/i
const MAX_STRING = 2000
const MAX_DEPTH = 6

/** Deep-copies a value for persistence: sensitive keys are masked and long strings truncated. */
export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value
  if (typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[max depth]'
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]),
  )
}

/** Query strings often carry tokens; keep the path for diagnostics and mask the rest. */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.origin}${u.pathname}${u.search ? '?[redacted]' : ''}`
  } catch {
    return '[invalid url]'
  }
}
