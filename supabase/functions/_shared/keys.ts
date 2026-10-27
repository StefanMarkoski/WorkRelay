export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function parseBearer(req: Request): string | null {
  const match = /^Bearer (wr_live_[0-9a-f]{64})$/.exec(req.headers.get('authorization') ?? '')
  return match ? match[1] : null
}

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
