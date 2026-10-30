import { beforeEach, describe, expect, it, vi } from 'vitest'

const A = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a11'
const B = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a12'
const URL_OK = 'https://discord.com/api/webhooks/123/SECRET'

interface Call { table: string; op: string; payload?: unknown }
let calls: Call[]
let updateRows: { preset_config: unknown }[] | null
let publishFails: boolean
let existing: { name: string; preset_config: unknown; draft_definition: unknown }

vi.mock('@/lib/supabase', () => {
  const builder = (table: string, op: string, payload?: unknown) => {
    calls.push({ table, op, payload })
    const result = () => {
      if (op === 'select') return { data: existing, error: null }
      if (op === 'insert') return { data: { id: 'w-new', preset_config: (payload as { preset_config: unknown }).preset_config }, error: null }
      return { data: op === 'update' && (payload as { preset_config?: unknown }).preset_config !== undefined && calls.filter((c) => c.op === 'update').length === 1 ? updateRows : null, error: null }
    }
    const chain: Record<string, unknown> = {}
    for (const m of ['eq', 'select']) chain[m] = () => chain
    chain.maybeSingle = () => Promise.resolve(result())
    chain.single = () => Promise.resolve(result())
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return chain
  }
  return {
    errorMessage: (e: { message?: string }) => e.message ?? 'error',
    supabase: {
      from: (table: string) => ({
        select: () => builder(table, 'select'),
        insert: (p: unknown) => builder(table, 'insert', p),
        update: (p: unknown) => builder(table, 'update', p),
      }),
      functions: { invoke: async () => (publishFails ? { error: { context: { json: async () => ({ issues: [{ message: 'Customer signups are off for Beta.' }] }) } } } : { error: null }) },
    },
  }
})

const { saveAutomation, assertSaved } = await import('./api')
const notify = (extra: object = {}) => ({ event: 'created', channel: 'discord', url: URL_OK, ...extra })

beforeEach(() => {
  calls = []
  publishFails = false
  updateRows = [{ preset_config: notify({ integration_ids: [A] }) }]
  existing = { name: 'old', preset_config: notify(), draft_definition: { schema_version: 1 } }
})

describe('assertSaved', () => {
  it('accepts what was sent, whatever the order of the shops', () => {
    expect(() => assertSaved([{ preset_config: notify({ integration_ids: [B, A] }) }], notify({ integration_ids: [A, B] }))).not.toThrow()
    expect(() => assertSaved([{ preset_config: notify() }], notify())).not.toThrow()
  })
  it('reports a dropped save and a lost shop choice instead of looking like a success', () => {
    expect(() => assertSaved([], notify())).toThrow(/nothing was changed/)
    expect(() => assertSaved(null, notify())).toThrow(/nothing was changed/)
    expect(() => assertSaved([{ preset_config: notify() }], notify({ integration_ids: [A] }))).toThrow(/shops were not saved/)
    expect(() => assertSaved([{ preset_config: notify({ integration_ids: [A] }) }], notify())).toThrow(/shops were not saved/)
  })
})

describe('saving an automation', () => {
  it('saves a shop choice, publishes, and enables', async () => {
    await saveAutomation({ organizationId: 'org', id: 'w1', kind: 'notify', config: notify({ integration_ids: [A] }), enable: true })
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['workflows:select', 'workflows:update', 'workflows:update'])
  })

  it('fails loudly when the database keeps the old choice', async () => {
    updateRows = [{ preset_config: notify() }] // the update "worked" but the shops did not stick
    await expect(saveAutomation({ organizationId: 'org', id: 'w1', kind: 'notify', config: notify({ integration_ids: [A] }), enable: true })).rejects.toThrow(/shops were not saved/)
    expect(calls.some((c) => c.op === 'update' && (c.payload as { enabled?: boolean })?.enabled)).toBe(false) // never enabled
  })

  it('fails loudly when no row was changed', async () => {
    updateRows = []
    await expect(saveAutomation({ organizationId: 'org', id: 'w1', kind: 'notify', config: notify({ integration_ids: [A] }), enable: true })).rejects.toThrow(/nothing was changed/)
  })

  it('puts an edit back as it was when publishing is refused, and shows the reason', async () => {
    publishFails = true
    await expect(saveAutomation({ organizationId: 'org', id: 'w1', kind: 'notify', config: notify({ integration_ids: [A] }), enable: true })).rejects.toThrow(/signups are off for Beta/)
    const restore = calls.filter((c) => c.op === 'update').at(-1)!.payload as { name: string; preset_config: unknown }
    expect(restore).toEqual(existing)
  })

  it('creates a new automation and checks it was stored with its shops', async () => {
    await saveAutomation({ organizationId: 'org', kind: 'notify', config: notify({ integration_ids: [A, B] }), enable: true })
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update'])
  })
})
