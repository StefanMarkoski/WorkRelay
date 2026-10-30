import type { PullHttp } from '../_shared/product-pull.ts'
import { assertPublicDestination } from './http-client.ts'

const TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 5_000_000

/**
 * GET for the scheduled product pull. Same destination rules as workflow actions (https, no private addresses, no
 * redirects) but it may send the shop's own Authorization value, and it accepts a larger response. The credential is
 * only ever sent to the URL the workspace configured for that shop. Residual DNS-rebinding risk: see http-client.ts.
 */
export function createPullClient(): PullHttp {
  return {
    async get(url, headers) {
      await assertPublicDestination(url)
      let res: Response
      try {
        res = await fetch(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch (err) {
        throw new Error(err instanceof Error && err.name === 'TimeoutError' ? 'The request timed out' : 'The request failed')
      }
      if (res.status >= 300 && res.status < 400) throw new Error('The shop redirected the request; redirects are not followed')
      const reader = res.body?.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (reader) {
        const { done, value } = await reader.read()
        if (done || !value) break
        received += value.length
        if (received > MAX_RESPONSE_BYTES) {
          await reader.cancel()
          throw new Error('The response is larger than 5 MB')
        }
        chunks.push(value)
      }
      const merged = new Uint8Array(received)
      let offset = 0
      for (const c of chunks) {
        merged.set(c, offset)
        offset += c.length
      }
      return { status: res.status, body: new TextDecoder().decode(merged) }
    },
  }
}
