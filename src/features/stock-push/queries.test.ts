import { describe, expect, it } from 'vitest'
import { conflictDiff } from './queries'

describe('conflictDiff', () => {
  it('is WorkRelay minus the shop, signed', () => {
    expect(conflictDiff({ workrelay_value: 10, shop_value: 8 })).toEqual({ diff: 2, text: '+2' })
    expect(conflictDiff({ workrelay_value: 4, shop_value: 9 })).toEqual({ diff: -5, text: '−5' })
    expect(conflictDiff({ workrelay_value: 3, shop_value: 3 })).toEqual({ diff: 0, text: 'same' })
  })
  it('groups thousands', () => {
    expect(conflictDiff({ workrelay_value: 2500, shop_value: 0 }).text).toBe('+2,500')
  })
})
