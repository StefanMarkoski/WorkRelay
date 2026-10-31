import { describe, expect, it } from 'vitest'
import { explainFailure } from './explain'

const event = (e: string | null) => explainFailure('event', e)
const run = (e: string | null) => explainFailure('run', e)

describe('incoming events', () => {
  it('explains WorkRelay’s own codes', () => {
    expect(event('malformed_json').title).toBe('The body was not valid JSON')
    expect(event('payload_too_large').fix).toContain('500 per request')
    expect(event('internal error').reason).toContain('WorkRelay’s side')
    expect(event('concurrent update conflict').fix).toContain('safe to repeat')
  })

  it('explains the validator’s real messages', () => {
    expect(event('event_id: Invalid input: expected string, received undefined')).toMatchObject({ title: 'A required field is missing' })
    expect(event('event_id: Invalid input: expected string, received undefined').reason).toContain('“event_id”')
    expect(event('order.totals.total_minor: Invalid input: expected number, received string').title).toBe('A value has the wrong type')
    expect(event('order.totals.total_minor: Invalid input: expected int, received number').title).toBe('A number has decimals')
    expect(event('order.totals.total_minor: Too small: expected number to be >=0').title).toBe('A negative amount was sent')
    expect(event('occurred_at: must be within the last 7 days and no more than one day from now').title).toBe('The event time is out of range')
    expect(event('order.placed_at: must be between the year 2000 and one day from now').title).toBe('A date is out of range')
    expect(event('occurred_at: Invalid ISO datetime').title).toBe('A date is not in the right format')
    expect(event('order.customer.email: Invalid email address').title).toBe('An email address is not valid')
    expect(event('order.currency: Invalid string: must match pattern /^[A-Za-z]{3}$/').title).toBe('A currency code is not valid')
    expect(event('event_id: Too big: expected string to have <=200 characters').reason).toContain('200 characters')
    expect(event('products.0.currency: currency is required with price_minor').title).toBe('A price has no currency')
  })

  it('names a product by its position, counting from 1', () => {
    expect(event('products.2.stock: Invalid input: expected number, received string').reason).toContain('“stock” of product number 3')
  })

  it('says how many other problems there were and leaves the list to the details', () => {
    const r = event('occurred_at: Invalid ISO datetime; occurred_at: must be within the last 7 days and no more than one day from now')
    expect(r.title).toBe('A date is not in the right format')
    expect(r.reason).toContain('1 more problem was found')
    expect(event('a: x; b: y; c: z').reason).toContain('2 more problems were found')
  })

  it('treats a bad envelope like any other list of problems', () => {
    expect(event('invalid_envelope: event_id: Invalid input: expected string, received undefined').title).toBe('A required field is missing')
  })

  it('shows what it does not recognise as it is, without guessing', () => {
    const r = event('something nobody wrote a rule for')
    expect(r.title).toBe('The event did not match the expected format')
    expect(r.reason).toContain('something nobody wrote a rule for')
    expect(event(null).title).toBe('The event failed')
    expect(event('   ').title).toBe('The event failed')
  })
})

describe('automation runs', () => {
  it('explains a destination that is gone, refused, busy or down', () => {
    expect(run('Step "Post" failed: HTTP 404').title).toBe('The step “Post” failed')
    expect(run('Step "Post" failed: HTTP 404').reason).toContain('no longer exists')
    expect(run('Step "Post" failed: HTTP 404').fix).toContain('deleted or mistyped')
    expect(run('Step "Post" failed: HTTP 401').reason).toContain('refused')
    expect(run('Step "Post" failed: HTTP 429').reason).toContain('slow down')
    expect(run('Step "Post" failed: HTTP 400').reason).toContain('rejected')
  })

  it('says how many times it tried', () => {
    const r = run('Step "Notify" failed after 3 attempts: HTTP 503')
    expect(r.title).toBe('The step “Notify” kept failing')
    expect(r.reason).toContain('tried 3 times')
    expect(r.reason).toContain('problem of its own')
  })

  it('explains network failures and blocked addresses', () => {
    expect(run('Step "Post" failed: fetch failed').reason).toContain('could not be reached')
    expect(run('Destination blocked: private address').title).toBe('WorkRelay would not send to that address')
  })

  it('explains the engine’s own endings', () => {
    expect(run('Approval was rejected').title).toBe('A person rejected the approval')
    expect(run('Execution timed out').title).toBe('The run took too long')
    expect(run('Workflow definition is invalid: x').title).toContain('settings are no longer valid')
    expect(run('Unknown step "a"').title).toContain('settings are no longer valid')
    expect(run('Email delivery is unavailable: no provider').title).toBe('Email is not available yet')
    expect(run('Recorded as failed by the workflow').title).toContain('on purpose')
  })

  it('falls back to the raw reason', () => {
    expect(run('odd').reason).toBe('odd')
    expect(run(null).title).toBe('The automation run failed')
  })
})
