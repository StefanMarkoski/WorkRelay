import { describe, expect, it } from 'vitest'
import { HttpError } from './engine.ts'
import { assertPublicDestination, type Resolver } from './public-destination.ts'

const answers = (a: string[], aaaa: string[] = []): Resolver => async (_h, type) => (type === 'A' ? a : aaaa)
const blocked = async (url: string, resolve: Resolver) => {
  try {
    await assertPublicDestination(url, resolve)
  } catch (e) {
    return e as HttpError
  }
  return null
}

describe('assertPublicDestination', () => {
  it('lets a public https address through', async () => {
    expect(await blocked('https://shop.example/stock', answers(['93.184.216.34']))).toBeNull()
    expect(await blocked('https://shop.example/stock', answers([], ['2606:2800:220:1:248:1893:25c8:1946']))).toBeNull()
  })

  it('refuses a name that resolves to a private, loopback or metadata address, and does not retry', async () => {
    for (const ip of ['10.0.0.5', '192.168.1.10', '172.16.0.1', '127.0.0.1', '169.254.169.254', '100.64.0.1']) {
      const err = await blocked('https://innocent.example/', answers([ip]))
      expect(err, ip).toBeInstanceOf(HttpError)
      expect(err!.message).toContain('private')
      expect(err!.retryable).toBe(false)
    }
  })

  it('refuses when ANY resolved address is private, so a mixed answer cannot slip through', async () => {
    expect(await blocked('https://mixed.example/', answers(['93.184.216.34', '10.0.0.5']))).not.toBeNull()
    expect(await blocked('https://mixed.example/', answers(['93.184.216.34'], ['::1']))).not.toBeNull()
  })

  it('refuses plain http, credentials in the URL and internal hostnames before looking anything up', async () => {
    const never: Resolver = async () => { throw new Error('should not be asked') }
    for (const url of ['http://shop.example/', 'https://user:pw@shop.example/', 'https://localhost/', 'https://db.internal/', 'https://10.0.0.1/']) {
      const err = await blocked(url, never)
      expect(err, url).toBeInstanceOf(HttpError)
      expect(err!.retryable).toBe(false)
    }
  })

  it('says so, and allows a retry, when the name cannot be resolved at all', async () => {
    const err = await blocked('https://nowhere.example/', async () => { throw new Error('nxdomain') })
    expect(err!.message).toContain('could not be resolved')
    expect(err!.retryable).toBe(true)
  })
})
