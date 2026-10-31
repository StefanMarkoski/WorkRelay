import { HttpError } from './engine.ts'
import { assertPublicDestination } from './public-destination.ts'
import type { PushHttp } from './stock-push.ts'

const TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 10_000

/**
 * POST for stock write-back. The same destination rules as every other outbound call (https, no private addresses, checked again
 * after the name is resolved) plus: redirects are never followed, the answer is cut at 10 KB, and the only secret that goes along is
 * the signature. Residual DNS-rebinding risk: see http-client.ts.
 */
export function createPushClient(): PushHttp {
  return {
    async post(url, headers, body) {
      await assertPublicDestination(url)
      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch (err) {
        throw new HttpError(err instanceof Error && err.name === 'TimeoutError' ? 'The request timed out.' : 'The request failed.', true)
      }
      const reader = res.body?.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (reader && received < MAX_RESPONSE_BYTES) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        received += value.length
      }
      await reader?.cancel().catch(() => {})
      const merged = new Uint8Array(Math.min(received, MAX_RESPONSE_BYTES))
      let offset = 0
      for (const c of chunks) {
        const room = merged.length - offset
        if (room <= 0) break
        merged.set(c.subarray(0, room), offset)
        offset += Math.min(c.length, room)
      }
      return { status: res.status, body: new TextDecoder().decode(merged) }
    },
  }
}
