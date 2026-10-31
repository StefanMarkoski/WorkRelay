import { describe, expect, it } from 'vitest'
import { duplicatesThatFire } from './duplicates'

const row = (id: string, key: string | null, enabled = true) => ({ id, preset_key: key, enabled })

describe('duplicatesThatFire', () => {
  it('flags every automation in a group of identical ones that are all on, with the size of the group', () => {
    expect([...duplicatesThatFire([row('a', 'k1'), row('b', 'k1'), row('c', 'k2')])]).toEqual([['a', 2], ['b', 2]])
    expect(duplicatesThatFire([row('a', 'k'), row('b', 'k'), row('c', 'k')]).get('c')).toBe(3)
  })
  it('does not flag a twin that is switched off, since it does not fire', () => {
    expect(duplicatesThatFire([row('a', 'k1'), row('b', 'k1', false)]).size).toBe(0)
    expect(duplicatesThatFire([row('a', 'k1', false), row('b', 'k1', false)]).size).toBe(0)
  })
  it('flags again once the second twin is switched back on', () => {
    expect(duplicatesThatFire([row('a', 'k1'), row('b', 'k1', true)]).size).toBe(2)
  })
  it('ignores automations with no key (custom workflows) and different settings', () => {
    expect(duplicatesThatFire([row('a', null), row('b', null), row('c', 'k1'), row('d', 'k2')]).size).toBe(0)
  })
  it('handles nothing at all', () => {
    expect(duplicatesThatFire([]).size).toBe(0)
  })
})
