/**
 * Static destination checks for outbound HTTP actions. Returns a reason string if the URL is
 * unsafe, otherwise null. The execution engine must additionally re-check the resolved IP at
 * request time (DNS rebinding) and refuse redirects to unchecked hosts.
 */
export function checkOutboundUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'Not a valid URL'
  }
  if (url.protocol !== 'https:') return 'Only https URLs are allowed'
  if (url.username || url.password) return 'Credentials in the URL are not allowed'
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    return 'Internal hostnames are not allowed'
  }
  if (host.includes(':')) return isPrivateV6(host) ? 'Private or internal address' : null
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (v4) return isPrivateV4(v4.slice(1).map(Number)) ? 'Private or internal address' : null
  // Numeric-looking hosts (decimal/hex/octal IPv4 forms) are rejected outright.
  if (/^(0x[0-9a-f]+|\d+)(\.|$)/i.test(host)) return 'Numeric hosts are not allowed'
  return null
}

/** For addresses obtained from DNS resolution at request time. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip)
  if (v4) return isPrivateV4(v4.slice(1).map(Number))
  return isPrivateV6(ip.toLowerCase())
}

function isPrivateV4([a, b]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isPrivateV6(h: string): boolean {
  if (h === '::' || h === '::1') return true
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe8') || h.startsWith('fe9') ||
      h.startsWith('fea') || h.startsWith('feb')) return true
  const mapped = /^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h)
  if (mapped) return isPrivateV4(mapped.slice(1).map(Number))
  return h.startsWith('::ffff:') // hex-form mapped addresses: reject
}
