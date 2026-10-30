import { describe, expect, it } from 'vitest'
import { contextShopFilter, shopIdOfContext } from './shop-scope'

const A = '6f1b1c1e-3b43-4a7e-9a52-0d9e5d3e3a01'

describe('shopIdOfContext', () => {
  it('reads the shop from an order automation, a customer or low-stock event, in that order of preference', () => {
    expect(shopIdOfContext({ order: { integration_id: A } })).toBe(A)
    expect(shopIdOfContext({ event: { integration_id: A } })).toBe(A)
    expect(shopIdOfContext({ order: { integration_id: A }, event: { integration_id: 'other' } })).toBe(A)
  })
  it('says nothing when the context does not name one', () => {
    for (const c of [null, undefined, {}, { order: {} }, { order: { integration_id: 5 } }, 'text']) expect(shopIdOfContext(c)).toBeNull()
  })
})

describe('contextShopFilter', () => {
  it('matches the shop under the order or the event', () => {
    expect(contextShopFilter(A)).toBe(`context->order->>integration_id.eq.${A},context->event->>integration_id.eq.${A}`)
  })
  it('never lets anything but a UUID into the filter', () => {
    expect(contextShopFilter('x),id.neq.0')).toBe('id.is.null')
    expect(contextShopFilter('')).toBe('id.is.null')
  })
})
