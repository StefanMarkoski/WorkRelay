import { describe, expect, it } from 'vitest'
import { checkOutboundUrl } from './ssrf.ts'
import { validateDefinition } from './workflow-schema.ts'

const def = (steps: unknown[], trigger: unknown = { type: 'manual' }) => ({ schema_version: 1, trigger, steps })
const rec = (id: string, extra = {}) => ({ id, name: id, type: 'record_result', result: 'succeeded', ...extra })

describe('validateDefinition', () => {
  it('accepts a branching workflow', () => {
    const r = validateDefinition(def([
      { id: 'check', name: 'Check', type: 'condition', field: 'order.total_minor', operator: 'gt', value: 10000, on_true: 'ask', on_false: 'done' },
      { id: 'ask', name: 'Ask', type: 'create_approval', title: 'Big order', reviewer_role: 'admin', next: 'done' },
      rec('done'),
    ]))
    expect(r.ok).toBe(true)
  })

  it('reports incomplete configuration', () => {
    const r = validateDefinition(def([{ id: 'a', name: 'A', type: 'http_request', method: 'POST', url: '', next: null }]))
    expect(r.ok).toBe(false)
  })

  it('requires at least one step and a complete trigger', () => {
    expect(validateDefinition(def([])).ok).toBe(false)
    expect(validateDefinition(def([rec('a')], { type: 'webhook' })).ok).toBe(false)
  })

  it('accepts the customer triggers, with an optional shop for signups, and rejects a malformed shop', () => {
    const ok = (trigger: unknown) => validateDefinition(def([rec('a')], trigger)).ok
    expect(ok({ type: 'customer_signup' })).toBe(true)
    expect(ok({ type: 'customer_signup', integration_id: '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a11' })).toBe(true)
    expect(ok({ type: 'customer_first_order' })).toBe(true)
    expect(ok({ type: 'customer_signup', integration_id: 'shop-1' })).toBe(false)
    expect(ok({ type: 'customer_signed_up' })).toBe(false)
  })

  it('accepts a list of shops on order and customer triggers, but never an empty or malformed one', () => {
    const A = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a11'
    const ok = (trigger: unknown) => validateDefinition(def([rec('a')], trigger)).ok
    for (const type of ['order_created', 'order_status_changed', 'customer_signup', 'customer_first_order']) {
      expect(ok({ type, integration_ids: [A] }), type).toBe(true)
      expect(ok({ type }), type).toBe(true)
      expect(ok({ type, integration_ids: [] }), type).toBe(false)
      expect(ok({ type, integration_ids: ['shop'] }), type).toBe(false)
    }
  })

  it('rejects unknown references, duplicates, loops and unreachable steps', () => {
    const msg = (steps: unknown[]) => {
      const r = validateDefinition(def(steps))
      return r.ok ? '' : r.issues.map((i) => i.message).join('|')
    }
    const http = (id: string, next: string | null) => ({ id, name: id, type: 'http_request', method: 'GET', url: 'https://example.com', next })
    expect(msg([http('a', 'zzz')])).toMatch(/unknown step/)
    expect(msg([rec('a'), rec('a')])).toMatch(/Duplicate/)
    expect(msg([http('a', 'b'), http('b', 'a')])).toMatch(/loop/)
    expect(msg([http('a', null), rec('orphan')])).toMatch(/unreachable/)
  })

  it('blocks email steps while no provider exists and unsafe HTTP destinations', () => {
    const email = { id: 'e', name: 'E', type: 'send_email', to: 'a@b.co', subject: 's', body: 'b', next: null }
    expect(validateDefinition(def([email])).ok).toBe(false)
    const http = { id: 'h', name: 'H', type: 'http_request', method: 'GET', url: 'https://169.254.169.254/latest', next: null }
    expect(validateDefinition(def([http])).ok).toBe(false)
  })
})

describe('checkOutboundUrl', () => {
  it.each([
    'http://example.com', 'https://localhost/x', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.1',
    'https://172.20.0.1', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/', 'https://[fd00::1]/',
    'https://[::ffff:127.0.0.1]/', 'https://2130706433/', 'https://0x7f000001/', 'https://user:pw@example.com',
    'https://metadata.google.internal', 'not a url',
  ])('rejects %s', (u) => expect(checkOutboundUrl(u)).not.toBeNull())

  it('allows public https hosts', () => {
    expect(checkOutboundUrl('https://api.example.com/hook?x=1')).toBeNull()
  })
})
