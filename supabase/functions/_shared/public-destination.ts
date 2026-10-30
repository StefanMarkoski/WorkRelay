import { HttpError } from './engine.ts'
import { checkOutboundUrl, isPrivateAddress } from './ssrf.ts'

// The only part of Deno this file needs. Declared here (it is erased at runtime) so the shared code type-checks without Deno's types.
declare const Deno: { resolveDns(host: string, type: 'A' | 'AAAA'): Promise<string[]> }

export type Resolver = (host: string, type: 'A' | 'AAAA') => Promise<string[]>
const denoResolver: Resolver = (host, type) => Deno.resolveDns(host, type)

/**
 * Static checks, then every address the name resolves to must be public. Throws HttpError otherwise.
 * Used for every outbound request the platform makes to a shop or a destination a tenant configured: workflow actions,
 * scheduled product pulls, and "Sync now". `resolve` is injectable so the rules can be tested without a network.
 */
export async function assertPublicDestination(url: string, resolve: Resolver = denoResolver): Promise<void> {
  const blocked = checkOutboundUrl(url)
  if (blocked) throw new HttpError(`Destination blocked: ${blocked}`, false)

  const host = new URL(url).hostname
  const addresses: string[] = []
  for (const type of ['A', 'AAAA'] as const) {
    try {
      addresses.push(...(await resolve(host, type)))
    } catch {
      // no records of this type
    }
  }
  if (addresses.length === 0) throw new HttpError('Destination could not be resolved', true)
  if (addresses.some(isPrivateAddress)) throw new HttpError('Destination blocked: resolves to a private address', false)
}
