import { describe, expect, it } from 'vitest'
import { inboxUrl, queueComment } from './inbox.ts'

const MANIFEST = 'https://snapshots.example.com/team/manifest'

describe('inboxUrl', () => {
  it('sits next to the manifest', () => {
    expect(inboxUrl(MANIFEST)).toBe('https://snapshots.example.com/team/inbox')
    expect(inboxUrl('http://localhost:8787/manifest')).toBe(
      'http://localhost:8787/inbox',
    )
  })

  it('refuses plain http for a remote host, so the token never travels in clear', () => {
    expect(() => inboxUrl('http://snapshots.example.com/manifest')).toThrow(
      /https/,
    )
  })
})

describe('queueComment', () => {
  const input = { bead: 'demo-1', body: 'hi', author: 'Ada' }

  it('POSTs the item with the inbox token and returns the client id', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response('{}', { status: 202 })
    }) as unknown as typeof fetch
    const { clientId } = await queueComment(MANIFEST, 'tok', input, fake)
    expect(clientId).toMatch(/^[0-9a-f-]{36}$/)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://snapshots.example.com/team/inbox')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.redirect).toBe('error')
    expect(
      (calls[0].init.headers as Record<string, string>)['authorization'],
    ).toBe('Bearer tok')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      op: 'comment.add',
      ...input,
      client_id: clientId,
    })
  })

  it('keeps a caller-supplied client id for retries', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const fake = (async () =>
      new Response('{}', { status: 202 })) as unknown as typeof fetch
    expect(
      (await queueComment(MANIFEST, 't', { ...input, clientId: id }, fake))
        .clientId,
    ).toBe(id)
  })

  it('throws on a non-202 answer without echoing the token', async () => {
    const fake = (async () =>
      new Response('{"error":"unauthorized"}', {
        status: 401,
      })) as unknown as typeof fetch
    const err = await queueComment(MANIFEST, 'secret-tok', input, fake).catch(
      (e: Error) => e,
    )
    expect((err as Error).message).toMatch(/HTTP 401/)
    expect((err as Error).message).not.toContain('secret-tok')
  })
})
