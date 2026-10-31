type Row = Record<string, any>

/** Mirrors list_failures for the mock build. The reasons are real texts the system writes. */
const DEMO_AGES_MIN = [8, 25, 70, 130, 400, 1100, 2000, 4300, 9000, 60 * 24 * 40, 60 * 24 * 100]

/** Mirrors failures_older_than for the mock build: how many of the demo failures are older than a number of days. */
export function failuresOlderThan(_db: Record<string, Row[]>, args: Record<string, any> = {}): number {
  return DEMO_AGES_MIN.filter((m) => m > Number(args.p_days) * 24 * 60).length
}

export function listFailures(db: Record<string, Row[]>, args: Record<string, any> = {}): Row[] {
  const { p_kind, p_integration, p_days = 7, p_limit = 25, p_offset = 0 } = args
  const shops = db.integrations ?? []
  const a = shops[0], b = shops[1] ?? shops[0]
  if (!a) return []
  const ago = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
  const ev = (id: string, m: number, shop: Row, subject: string, error: string) => ({ id, kind: 'event', at: ago(m), integration_id: shop.id, integration_name: shop.name, subject, ref: `evt_${id}`, error })
  const run = (id: string, m: number, subject: string, error: string) => ({ id, kind: 'run', at: ago(m), integration_id: null, integration_name: null, subject, ref: null, error })
  const all = [
    ev('f1', 8, a, 'order.created', 'order.totals.total_minor: Too small: expected number to be >=0'),
    run('f2', 25, 'Notify Discord when a new order arrives', 'Step "Post to Discord" failed: HTTP 404'),
    ev('f3', 70, b, 'inventory.push', 'products.2.stock: Invalid input: expected number, received string'),
    ev('f4', 130, a, 'order.created', 'occurred_at: Invalid ISO datetime; occurred_at: must be within the last 7 days and no more than one day from now'),
    ev('f5', 400, b, 'customer.created', 'internal error'),
    run('f6', 1100, 'Review orders above 70k', 'Step "Ask for approval" failed after 3 attempts: HTTP 503'),
    ev('f7', 2000, a, 'inventory.push', 'malformed_json'),
    ev('f8', 4300, a, 'order.created', 'order.customer.email: Invalid email address'),
    run('f9', 9000, 'Low stock alert', 'Approval was rejected'),
  ]
  const since = Date.now() - p_days * 86_400_000
  const rows = all
    .filter((r) => new Date(r.at).getTime() >= since && (!p_kind || r.kind === p_kind) && (!p_integration || r.integration_id === p_integration))
    .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
  return rows.slice(p_offset, p_offset + p_limit).map((r) => ({ ...r, total_count: rows.length }))
}
