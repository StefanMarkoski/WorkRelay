import { describe, expect, it } from 'vitest'
import { shopLabel } from './shop-label'

describe('shopLabel', () => {
  it('puts the currency after the name so two shops can be told apart', () => {
    expect(shopLabel({ name: 'Game Store', currency: 'MKD' })).toBe('Game Store (MKD)')
    expect(shopLabel({ name: 'Game Store', currency: 'USD' })).toBe('Game Store (USD)')
  })
  it('is just the name until a currency is set', () => {
    expect(shopLabel({ name: 'New shop', currency: null })).toBe('New shop')
    expect(shopLabel({ name: 'New shop' })).toBe('New shop')
  })
})
