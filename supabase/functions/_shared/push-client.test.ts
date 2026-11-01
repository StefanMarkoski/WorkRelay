import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./public-destination.ts', () => ({ assertPublicDestination: async () => {} }))
const { createPushClient } = await import('./push-client.ts')

const original = globalThis.fetch
afterEach(() => { globalThis.fetch = original })

function stream(chunks: (string | Error)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) return controller.close()
      const c = chunks[i++]
      if (c instanceof Error) return controller.error(c)
      controller.enqueue(enc.encode(c))
    },
  })
}

describe('the push client', () => {
  it('returns the status and the body', async () => {
    globalThis.fetch = (async () => new Response(stream(['{"challenge":', '"abc"}']), { status: 200 })) as typeof fetch
    expect(await createPushClient().post('https://shop.example.com/s', {}, '{}')).toEqual({ status: 200, body: '{"challenge":"abc"}' })
  })

  it('never follows a redirect', async () => {
    const seen: RequestInit[] = []
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { seen.push(init ?? {}); return new Response('', { status: 302 }) }) as typeof fetch
    const out = await createPushClient().post('https://shop.example.com/s', {}, '{}')
    expect(out.status).toBe(302)
    expect(seen[0].redirect).toBe('manual')
  })

  it('cuts a long answer at 10 KB', async () => {
    globalThis.fetch = (async () => new Response(stream(['x'.repeat(8000), 'y'.repeat(8000)]), { status: 200 })) as typeof fetch
    const out = await createPushClient().post('https://shop.example.com/s', {}, '{}')
    expect(out.body.length).toBe(10_000)
  })

  it('keeps the status when the body breaks after it arrived: that is not a failed request', async () => {
    globalThis.fetch = (async () => new Response(stream(['{"ok":', new Error('connection reset')]), { status: 200 })) as typeof fetch
    const out = await createPushClient().post('https://shop.example.com/s', {}, '{}')
    expect(out.status).toBe(200)
    expect(out.body).toBe('{"ok":')
  })

  it('reports a request that never got an answer as a failure with a fixed phrase', async () => {
    globalThis.fetch = (async () => { throw new Error('secret internal detail') }) as typeof fetch
    await expect(createPushClient().post('https://shop.example.com/s', {}, '{}')).rejects.toThrow('The request failed.')
  })
})
