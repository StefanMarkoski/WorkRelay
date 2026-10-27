export type Operator = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'exists'

export function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

export function evaluateCondition(ctx: unknown, field: string, op: Operator, expected: unknown): boolean {
  const actual = getPath(ctx, field)
  switch (op) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'eq':
      return actual != null && (String(actual) === String(expected) || (asNumber(actual) !== null && asNumber(actual) === asNumber(expected)))
    case 'neq':
      return !evaluateCondition(ctx, field, 'eq', expected)
    case 'gt':
    case 'lt': {
      const a = asNumber(actual)
      const b = asNumber(expected)
      if (a === null || b === null) return false
      return op === 'gt' ? a > b : a < b
    }
    case 'contains':
      return actual != null && String(actual).toLowerCase().includes(String(expected ?? '').toLowerCase())
  }
}
