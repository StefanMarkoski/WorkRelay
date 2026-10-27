const SENSITIVE = /authorization|secret|token|password|key|email|phone|address|name/i

export interface Logger {
  info(msg: string, ctx?: Record<string, unknown>): void
  error(msg: string, ctx?: Record<string, unknown>): void
}

function redact(ctx: Record<string, unknown> = {}) {
  return Object.fromEntries(
    Object.entries(ctx).map(([k, v]) => [k, SENSITIVE.test(k) && k !== 'integration_id' ? '[redacted]' : v]),
  )
}

export const consoleLogger: Logger = {
  info: (msg, ctx) => console.log(JSON.stringify({ level: 'info', msg, ...redact(ctx) })),
  error: (msg, ctx) => console.error(JSON.stringify({ level: 'error', msg, ...redact(ctx) })),
}
