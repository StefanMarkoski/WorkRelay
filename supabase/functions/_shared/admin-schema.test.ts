import { describe, expect, it } from 'vitest'
import { createTenantSchema } from './admin-schema.ts'

const ok = { org_name: 'Acme', email: 'owner@acme.com', password: 'a-long-enough-pw' }

describe('createTenantSchema', () => {
  it('accepts a valid tenant and trims the name', () => {
    const r = createTenantSchema.safeParse({ ...ok, org_name: '  Acme  ' })
    expect(r.success && r.data.org_name).toBe('Acme')
  })
  it('rejects short and overlong passwords, bad emails, and blank names', () => {
    expect(createTenantSchema.safeParse({ ...ok, password: 'short' }).success).toBe(false)
    expect(createTenantSchema.safeParse({ ...ok, password: 'x'.repeat(73) }).success).toBe(false)
    expect(createTenantSchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false)
    expect(createTenantSchema.safeParse({ ...ok, org_name: '   ' }).success).toBe(false)
  })
  it('never echoes the submitted password in validation messages', () => {
    const r = createTenantSchema.safeParse({ ...ok, password: 'tiny-secret' })
    expect(JSON.stringify(r.success ? {} : r.error.issues)).not.toContain('tiny-secret')
  })
})
