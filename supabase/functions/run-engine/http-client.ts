import { HttpError, type HttpClient } from '../_shared/engine.ts'
import { assertPublicDestination } from '../_shared/public-destination.ts'

const TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 10_000

/**
 * Outbound HTTP for workflow actions.
 * - https only, static host checks, then every resolved address is checked.
 * - Redirects are never followed (a 3xx is returned as-is and treated as a failure).
 * - No user-supplied headers or credentials are sent, so nothing sensitive can leak to the destination.
 * Residual risk: fetch() resolves the name again, so a DNS-rebinding attacker could race the check.
 * Keep the destination allowlist for sensitive deployments or run this behind an egress proxy.
 */
export function createHttpClient(): HttpClient {
  return {
    async request({ method, url, body }) {
      await assertPublicDestination(url)

      try {
        const res = await fetch(url, {
          method,
          body: method === 'GET' ? undefined : body,
          headers: body ? { 'content-type': 'application/json' } : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
        const reader = res.body?.getReader()
        let received = 0
        const chunks: Uint8Array[] = []
        while (reader) {
          const { done, value } = await reader.read()
          if (done || !value) break
          chunks.push(value)
          received += value.length
          if (received >= MAX_RESPONSE_BYTES) {
            await reader.cancel()
            break
          }
        }
        const merged = new Uint8Array(received)
        let offset = 0
        for (const c of chunks) {
          merged.set(c, offset)
          offset += c.length
        }
        return { status: res.status, body: new TextDecoder().decode(merged.slice(0, MAX_RESPONSE_BYTES)) }
      } catch (err) {
        const message = err instanceof Error && err.name === 'TimeoutError' ? 'Request timed out' : 'Request failed'
        throw new HttpError(message, true)
      }
    },
  }
}
