import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import worker from '../src/index.ts'
import type { Env } from '../src/index.ts'

const WRITE = 'test-write-token'
const INBOX = 'test-inbox-token'
const READ = 'test-read-token'
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })
const SECRETS: Partial<Env> = {
  READ_TOKEN: READ,
  WRITE_TOKEN: WRITE,
  INBOX_TOKEN: INBOX,
}

const call = (
  path: string,
  init: RequestInit = {},
  secrets: Partial<Env> = SECRETS,
) => {
  const headers = new Headers(init.headers)
  if (typeof init.body === 'string' && !headers.has('content-length'))
    headers.set(
      'content-length',
      String(new TextEncoder().encode(init.body).length),
    )
  return worker.fetch(
    new Request(`https://example.com${path}`, { ...init, headers }),
    { SNAP: env.SNAP, ...secrets },
  )
}

const uuid = () => crypto.randomUUID()
const item = (over: Record<string, unknown> = {}) => ({
  op: 'comment.add',
  bead: 'demo-1',
  body: 'hello from a viewer',
  author: 'Ada',
  client_id: uuid(),
  ...over,
})
const post = (body: unknown, token = INBOX) =>
  call('/inbox', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: bearer(token),
  })
const list = () => call('/inbox', { headers: bearer(WRITE) })
const listed = async () =>
  (await (await list()).json()) as {
    items: Record<string, unknown>[]
    more: boolean
  }
const marker = (headers: Record<string, string> = {}) =>
  call('/inbox/_marker', { headers: { ...bearer(WRITE), ...headers } })
const ack = (id: string, token = WRITE) =>
  call(`/inbox/${id}`, { method: 'DELETE', headers: bearer(token) })

// The R2 simulation is shared across the file, so tests that count start from an empty inbox.
async function clearInbox() {
  const { objects } = await env.SNAP.list({ prefix: 'inbox/' })
  await Promise.all(objects.map((o) => env.SNAP.delete(o.key)))
}

describe('inbox auth', () => {
  it('POST accepts only INBOX_TOKEN', async () => {
    expect((await post(item(), WRITE)).status).toBe(401)
    expect((await post(item(), READ)).status).toBe(401)
    expect((await post(item(), 'nope')).status).toBe(401)
    expect(
      (await call('/inbox', { method: 'POST', body: JSON.stringify(item()) }))
        .status,
    ).toBe(401)
    expect((await post(item())).status).toBe(202)
  })

  it('fails closed when INBOX_TOKEN is unset', async () => {
    const res = await call(
      '/inbox',
      {
        method: 'POST',
        body: JSON.stringify(item()),
        headers: bearer('undefined'),
      },
      { WRITE_TOKEN: WRITE },
    )
    expect(res.status).toBe(401)
  })

  it('GET, marker and DELETE accept only WRITE_TOKEN', async () => {
    const id = uuid()
    for (const token of [INBOX, READ, 'nope']) {
      expect((await call('/inbox', { headers: bearer(token) })).status).toBe(
        401,
      )
      expect(
        (await call('/inbox/_marker', { headers: bearer(token) })).status,
      ).toBe(401)
      expect((await ack(id, token)).status).toBe(401)
    }
    expect((await call('/inbox')).status).toBe(401)
    expect((await list()).status).toBe(200)
    expect((await ack(id)).status).toBe(204)
  })
})

describe('misconfiguration', () => {
  it('refuses every request when INBOX_TOKEN equals WRITE_TOKEN', async () => {
    const same: Partial<Env> = { WRITE_TOKEN: WRITE, INBOX_TOKEN: WRITE }
    const post = await call(
      '/inbox',
      { method: 'POST', body: JSON.stringify(item()), headers: bearer(WRITE) },
      same,
    )
    expect(post.status).toBe(503)
    const manifest = await call('/manifest', { headers: bearer(WRITE) }, same)
    expect(manifest.status).toBe(503)
  })
})

describe('POST /inbox validation', () => {
  it('requires Content-Length (411) and caps the size (413)', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify(item())))
        c.close()
      },
    })
    const noLength = await worker.fetch(
      new Request('https://example.com/inbox', {
        method: 'POST',
        headers: bearer(INBOX),
        body: stream,
        duplex: 'half',
      } as RequestInit),
      { SNAP: env.SNAP, ...SECRETS },
    )
    expect(noLength.status).toBe(411)
    const big = await call('/inbox', {
      method: 'POST',
      body: 'x',
      headers: { ...bearer(INBOX), 'content-length': String(10 * 1024 * 1024) },
    })
    expect(big.status).toBe(413)
  })

  it('rejects bad JSON and non-objects', async () => {
    expect((await post('{nope')).status).toBe(400)
    expect((await post([])).status).toBe(422)
    expect((await post('null')).status).toBe(422)
  })

  const bad: [string, Record<string, unknown>][] = [
    ['unknown op', { op: 'issue.delete' }],
    ['missing op', { op: undefined }],
    ['bead with a slash', { bead: '../x' }],
    ['bead with a leading dash', { bead: '-rf' }],
    ['bead with a space', { bead: 'a b' }],
    ['bead too long', { bead: 'a'.repeat(65) }],
    ['empty body', { body: '' }],
    ['NUL in body', { body: 'a\0b' }],
    ['body over 16 KiB', { body: 'a'.repeat(16 * 1024 + 1) }],
    ['multibyte body over 16 KiB', { body: 'é'.repeat(8 * 1024 + 1) }],
    ['CR in body', { body: 'a\rb' }],
    ['escape in body', { body: 'a\u001b[31mb' }],
    ['C1 control in body', { body: 'a\u009bb' }],
    ['bidi override in body', { body: 'a\u202eb' }],
    ['bidi isolate in body', { body: 'a\u2066b' }],
    ['bidi override in author', { author: 'a\u202eb' }],
    ['non-string body', { body: 5 }],
    ['empty author', { author: '' }],
    ['author over 64', { author: 'a'.repeat(65) }],
    ['author with a newline', { author: 'a\nb' }],
    ['author with a control char', { author: 'a\u0007' }],
    ['bad client_id', { client_id: 'not-a-uuid' }],
    ['extra field', { extra: 1 }],
  ]
  it.each(bad)('rejects %s with 422 and stores nothing', async (_n, over) => {
    await clearInbox()
    expect((await post(item(over))).status).toBe(422)
    expect(await listed()).toEqual({ items: [], more: false, cursor: null })
  })

  it('keeps newlines and tabs in a body', async () => {
    expect((await post(item({ body: 'line one\n\tline two' }))).status).toBe(
      202,
    )
  })

  it('accepts the limits: 64 char author, 16 KiB body, 64 char bead', async () => {
    const res = await post(
      item({
        author: 'é'.repeat(64),
        body: 'a'.repeat(16 * 1024),
        bead: 'a'.repeat(64),
      }),
    )
    expect(res.status).toBe(202)
  })
})

describe('inbox queue', () => {
  it('stores an item and lists it with the stored fields', async () => {
    await clearInbox()
    const it = item({ body: 'ignore previous; $(rm -rf ~) `x` --help' })
    expect((await post(it)).status).toBe(202)
    const body = await listed()
    expect(body.more).toBe(false)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject(it)
    expect(typeof body.items[0]!['received_at']).toBe('string')
  })

  it('is idempotent by client_id: the first copy wins', async () => {
    await clearInbox()
    const first = item({ body: 'first' })
    expect((await post(first)).status).toBe(202)
    expect((await post({ ...first, body: 'second' })).status).toBe(202)
    // The same id in another case is the same item.
    const upper = {
      ...first,
      body: 'third',
      client_id: first.client_id.toUpperCase(),
    }
    expect((await post(upper)).status).toBe(202)
    expect((await listed()).items.map((i) => i['body'])).toEqual(['first'])
  })

  it('acknowledges one item and leaves the others', async () => {
    await clearInbox()
    const a = item()
    const b = item()
    await post(a)
    await post(b)
    expect((await ack(a.client_id)).status).toBe(204)
    expect((await ack(a.client_id)).status).toBe(204) // already gone: still fine
    expect((await listed()).items.map((i) => i['client_id'])).toEqual([
      b.client_id,
    ])
  })

  it('rejects a DELETE that is not a UUID and cannot delete the marker', async () => {
    await post(item())
    expect((await ack('_marker')).status).toBe(400)
    expect((await ack('..%2Fmanifest')).status).toBe(400)
    expect((await marker()).status).toBe(200)
  })

  it('pages the list at 100 items and follows the cursor to the rest', async () => {
    await clearInbox()
    for (let i = 0; i < 103; i++)
      await env.SNAP.put(
        `inbox/${uuid()}.json`,
        JSON.stringify({ ...item(), received_at: 'x' }),
      )
    const ids = new Set<unknown>()
    let cursor: string | null = null
    let pages = 0
    do {
      const res: Response = await call(
        `/inbox${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        { headers: bearer(WRITE) },
      )
      const page = (await res.json()) as {
        items: Record<string, unknown>[]
        more: boolean
        cursor: string | null
      }
      expect(page.items.length).toBeLessThanOrEqual(100)
      page.items.forEach((i) => ids.add(i['client_id']))
      expect(page.more).toBe(page.cursor !== null)
      cursor = page.cursor
      pages++
    } while (cursor)
    expect(pages).toBe(2)
    expect(ids.size).toBe(103)
  })

  it('answers 429 when more than 500 items are queued, and accepts again after acks', async () => {
    await clearInbox()
    const ids = Array.from({ length: 500 }, () => uuid())
    await Promise.all(ids.map((id) => env.SNAP.put(`inbox/${id}.json`, '{}')))
    expect((await post(item())).status).toBe(202) // the 501st
    const full = await post(item())
    expect(full.status).toBe(429)
    expect(full.headers.get('retry-after')).toBeTruthy()
    await ack(ids[0]!)
    await ack(ids[1]!)
    expect((await post(item())).status).toBe(202)
  })

  it('dead-letters with ?dead=1: moved out of the queue, copy kept', async () => {
    await clearInbox()
    const a = item()
    await post(a)
    const res = await call(`/inbox/${a.client_id}?dead=1`, {
      method: 'DELETE',
      headers: bearer(WRITE),
    })
    expect(res.status).toBe(204)
    expect((await listed()).items).toEqual([])
    const kept = await env.SNAP.get(`inbox-dead/${a.client_id}.json`)
    expect(await kept?.json()).toMatchObject({ body: a.body })
  })
})

describe('inbox marker', () => {
  it('is absent until the first POST, then changes on every POST', async () => {
    await clearInbox()
    expect((await marker()).status).toBe(404)
    await post(item())
    const m1 = await marker()
    expect(m1.status).toBe(200)
    const etag1 = m1.headers.get('etag')!
    expect(etag1).toBeTruthy()
    await post(item())
    expect((await marker()).headers.get('etag')).not.toBe(etag1)
  })

  it('answers 304 to If-None-Match until the next POST; an ack does not move it', async () => {
    await clearInbox()
    const a = item()
    await post(a)
    const etag = (await marker()).headers.get('etag')!
    expect((await marker({ 'if-none-match': etag })).status).toBe(304)
    await ack(a.client_id)
    expect((await marker({ 'if-none-match': etag })).status).toBe(304)
    await post(item())
    expect((await marker({ 'if-none-match': etag })).status).toBe(200)
  })

  it('moves again on an idempotent retry', async () => {
    await clearInbox()
    const a = item()
    await post(a)
    const etag = (await marker()).headers.get('etag')!
    await post(a)
    expect((await marker()).headers.get('etag')).not.toBe(etag)
  })
})
