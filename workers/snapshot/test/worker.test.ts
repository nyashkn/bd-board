import { env } from 'cloudflare:workers'
import { beforeEach, describe, expect, it } from 'vitest'
import worker from '../src/index.ts'
import type { Env } from '../src/index.ts'

const READ = 'test-read-token'
const WRITE = 'test-write-token'
const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

const call = (
  path: string,
  init: RequestInit = {},
  secrets: Partial<Env> = { READ_TOKEN: READ, WRITE_TOKEN: WRITE },
): Promise<Response> => {
  // A real client sends Content-Length for a sized body; `new Request` does not add it.
  const headers = new Headers(init.headers)
  const { body } = init
  if (
    !headers.has('content-length') &&
    (typeof body === 'string' || body instanceof Uint8Array)
  ) {
    const size =
      typeof body === 'string' ? new TextEncoder().encode(body).length : body.length
    headers.set('content-length', String(size))
  }
  return worker.fetch(
    new Request(`https://example.com${path}`, { ...init, headers }),
    { SNAP: env.SNAP, ...secrets },
  )
}

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

type Snap = Awaited<ReturnType<typeof makeSnapshot>>

// Not real gzip content, only the magic bytes the Worker checks; the Worker never decompresses.
async function makeSnapshot(tag = 'a') {
  const bytes = new Uint8Array([
    0x1f,
    0x8b,
    ...new TextEncoder().encode(`synthetic ${tag}`),
  ])
  const sha256 = await sha256Hex(bytes)
  return { bytes, sha256, key: `snap-${sha256.slice(0, 16)}.jsonl.gz` }
}

const manifestFor = (s: Snap, over: Record<string, unknown> = {}) => ({
  version: 1,
  key: s.key,
  sha256: s.sha256,
  size: s.bytes.length,
  counts: { issues: 2, comments: 1 },
  head: 'abc123',
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

const putSnap = (s: Snap, token = WRITE) =>
  call(`/snap/${s.key}`, {
    method: 'PUT',
    body: s.bytes,
    headers: bearer(token),
  })

const putManifest = (body: unknown, headers: Record<string, string>) =>
  call('/manifest', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { ...bearer(WRITE), ...headers },
  })

const getManifest = async () =>
  await (
    await call('/manifest', { headers: bearer(READ) })
  ).json<Record<string, unknown>>()

beforeEach(async () => {
  const { objects } = await env.SNAP.list()
  if (objects.length) await env.SNAP.delete(objects.map((o) => o.key))
})

describe('auth', () => {
  it('rejects a missing or wrong token on every route', async () => {
    const s = await makeSnapshot()
    const routes: [string, RequestInit][] = [
      ['/manifest', {}],
      [`/snap/${s.key}`, {}],
      [`/snap/${s.key}`, { method: 'PUT', body: s.bytes }],
      ['/manifest', { method: 'PUT', body: '{}' }],
    ]
    for (const [path, init] of routes) {
      const label = `${init.method ?? 'GET'} ${path}`
      expect((await call(path, init)).status, `${label} no token`).toBe(401)
      const wrong = await call(path, { ...init, headers: bearer('nope') })
      expect(wrong.status, `${label} wrong token`).toBe(401)
    }
  })

  it('accepts a case-insensitive Bearer scheme and extra spaces', async () => {
    for (const authorization of [`bearer ${READ}`, `BEARER   ${READ}`]) {
      const res = await call('/manifest', { headers: { authorization } })
      expect(res.status, authorization).toBe(404) // authorized, no manifest yet
    }
    const wrong = await call('/manifest', {
      headers: { authorization: `Basic ${READ}` },
    })
    expect(wrong.status).toBe(401)
  })

  it('does not let the read token write', async () => {
    const s = await makeSnapshot()
    expect((await putSnap(s, READ)).status).toBe(401)
    const m = await putManifest(manifestFor(s), {
      ...bearer(READ),
      'if-none-match': '*',
    })
    expect(m.status).toBe(401)
  })

  it('fails closed when a secret is unset or empty', async () => {
    const s = await makeSnapshot()
    for (const secrets of [
      {},
      { READ_TOKEN: '', WRITE_TOKEN: '' },
      { READ_TOKEN: '  ', WRITE_TOKEN: ' ' },
    ]) {
      for (const token of ['undefined', '', 'null']) {
        const headers = bearer(token)
        expect((await call('/manifest', { headers }, secrets)).status).toBe(401)
        const put = await call(
          `/snap/${s.key}`,
          { method: 'PUT', body: s.bytes, headers },
          secrets,
        )
        expect(put.status).toBe(401)
      }
      expect((await call('/manifest', {}, secrets)).status).toBe(401)
    }
  })

  it('keeps the write token working when only the read secret is missing', async () => {
    const res = await call(
      '/manifest',
      { headers: bearer(WRITE) },
      { WRITE_TOKEN: WRITE },
    )
    expect(res.status).toBe(404) // authorized, no manifest yet
  })

  it('returns 404 for unknown routes and methods', async () => {
    expect((await call('/nope', { headers: bearer(READ) })).status).toBe(404)
    const del = await call('/manifest', {
      method: 'DELETE',
      headers: bearer(WRITE),
    })
    expect(del.status).toBe(404)
    const post = await call('/', { method: 'POST', headers: bearer(WRITE) })
    expect(post.status).toBe(404)
  })
})

describe('snapshots', () => {
  it('stores a snapshot and serves it with immutable cache headers and an ETag', async () => {
    const s = await makeSnapshot()
    expect((await putSnap(s)).status).toBe(201)
    const res = await call(`/snap/${s.key}`, { headers: bearer(READ) })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    )
    expect(res.headers.get('etag')).toBeTruthy()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(s.bytes)
  })

  it('returns 304 for a matching If-None-Match', async () => {
    const s = await makeSnapshot()
    await putSnap(s)
    const first = await call(`/snap/${s.key}`, { headers: bearer(READ) })
    const res = await call(`/snap/${s.key}`, {
      headers: {
        ...bearer(READ),
        'if-none-match': first.headers.get('etag')!,
      },
    })
    expect(res.status).toBe(304)
  })

  it('404s a well-formed key that does not exist', async () => {
    const s = await makeSnapshot()
    expect(
      (await call(`/snap/${s.key}`, { headers: bearer(READ) })).status,
    ).toBe(404)
  })

  it.each([
    'snap-abc.jsonl.gz', // too short
    `snap-${'a'.repeat(15)}.jsonl.gz`, // below the 16-char minimum
    `snap-${'a'.repeat(65)}.jsonl.gz`, // too long
    'snap-ABCDEF01.jsonl.gz', // uppercase
    'snap-abcdef01.jsonl', // wrong suffix
    'snap-abcdef01.jsonl.gz.bak',
    '..%2Fmanifest.json',
    'snap-abcdef01.jsonl.gz/extra',
    'manifest.json',
  ])('rejects the key %s', async (key) => {
    expect((await call(`/snap/${key}`, { headers: bearer(READ) })).status).toBe(
      400,
    )
    const put = await call(`/snap/${key}`, {
      method: 'PUT',
      body: new Uint8Array([0x1f, 0x8b]),
      headers: bearer(WRITE),
    })
    expect(put.status).toBe(400)
  })

  it('rejects a body whose sha256 does not match the key', async () => {
    const a = await makeSnapshot('a')
    const b = await makeSnapshot('b')
    const res = await call(`/snap/${a.key}`, {
      method: 'PUT',
      body: b.bytes,
      headers: bearer(WRITE),
    })
    expect(res.status).toBe(422)
    expect(await env.SNAP.head(a.key)).toBeNull()
  })

  it('rejects a body that is not gzip', async () => {
    const bytes = new TextEncoder().encode('plain text')
    const key = `snap-${(await sha256Hex(bytes)).slice(0, 16)}.jsonl.gz`
    const res = await call(`/snap/${key}`, {
      method: 'PUT',
      body: bytes,
      headers: bearer(WRITE),
    })
    expect(res.status).toBe(400)
  })

  it('requires a Content-Length so the size cap cannot be skipped', async () => {
    const s = await makeSnapshot()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(s.bytes)
        c.close()
      },
    })
    const res = await call(`/snap/${s.key}`, {
      method: 'PUT',
      body,
      headers: bearer(WRITE),
      duplex: 'half',
    } as RequestInit)
    expect(res.status).toBe(411)
    expect(await env.SNAP.head(s.key)).toBeNull()
  })

  it('treats a duplicate PUT as a no-op that keeps the stored object', async () => {
    const s = await makeSnapshot()
    expect((await putSnap(s)).status).toBe(201)
    const before = await env.SNAP.head(s.key)
    const again = await putSnap(s)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ key: s.key, created: false })
    const after = await env.SNAP.head(s.key)
    expect(after?.etag).toBe(before?.etag)
    expect(after?.uploaded).toEqual(before?.uploaded)
  })
})

describe('manifest', () => {
  it('404s before the first publish', async () => {
    expect((await call('/manifest', { headers: bearer(READ) })).status).toBe(
      404,
    )
  })

  it('serves 200 with an ETag, then 304 for If-None-Match, then 200 after a change', async () => {
    const s1 = await makeSnapshot('1')
    const s2 = await makeSnapshot('2')
    await putSnap(s1)
    await putSnap(s2)
    expect(
      (await putManifest(manifestFor(s1), { 'if-none-match': '*' })).status,
    ).toBe(200)

    const first = await call('/manifest', { headers: bearer(READ) })
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    const etag = first.headers.get('etag')!
    expect((await first.json<{ key: string }>()).key).toBe(s1.key)

    const cached = await call('/manifest', {
      headers: { ...bearer(READ), 'if-none-match': etag },
    })
    expect(cached.status).toBe(304)
    expect(cached.headers.get('etag')).toBe(etag)
    expect(cached.headers.get('cache-control')).toBe('private, no-cache')
    expect(await cached.text()).toBe('')

    const weak = await call('/manifest', {
      headers: { ...bearer(READ), 'if-none-match': `W/${etag}` },
    })
    expect(weak.status).toBe(304)

    expect(
      (await putManifest(manifestFor(s2), { 'if-match': etag })).status,
    ).toBe(200)
    const changed = await call('/manifest', {
      headers: { ...bearer(READ), 'if-none-match': etag },
    })
    expect(changed.status).toBe(200)
    expect((await changed.json<{ key: string }>()).key).toBe(s2.key)
  })

  it('lets the write token read the manifest', async () => {
    const s = await makeSnapshot()
    await putSnap(s)
    await putManifest(manifestFor(s), { 'if-none-match': '*' })
    const res = await call('/manifest', { headers: bearer(WRITE) })
    expect(res.status).toBe(200)
  })

  describe('compare-and-swap', () => {
    it('lets exactly one of two concurrent writers win', async () => {
      const s1 = await makeSnapshot('1')
      const s2 = await makeSnapshot('2')
      const s3 = await makeSnapshot('3')
      for (const s of [s1, s2, s3]) await putSnap(s)
      const base = await putManifest(manifestFor(s1), { 'if-none-match': '*' })
      const etag = base.headers.get('etag')!
      const results = await Promise.all([
        putManifest(manifestFor(s2), { 'if-match': etag }),
        putManifest(manifestFor(s3), { 'if-match': etag }),
      ])
      expect(results.map((r) => r.status).sort()).toEqual([200, 412])
      const winner = results.findIndex((r) => r.status === 200) === 0 ? s2 : s3
      expect((await getManifest())['key']).toBe(winner.key)
    })

    it('rejects a manifest for a snapshot stored without verified sha256 metadata', async () => {
      const s = await makeSnapshot()
      await env.SNAP.put(s.key, s.bytes) // bypasses the Worker, so no customMetadata
      const res = await putManifest(manifestFor(s), { 'if-none-match': '*' })
      expect(res.status).toBe(422)
    })

    it('requires a precondition', async () => {
      const s = await makeSnapshot()
      await putSnap(s)
      expect((await putManifest(manifestFor(s), {})).status).toBe(428)
    })

    it('refuses If-Match for the first write and If-None-Match: * once one exists', async () => {
      const s = await makeSnapshot()
      await putSnap(s)
      expect(
        (await putManifest(manifestFor(s), { 'if-match': '"deadbeef"' }))
          .status,
      ).toBe(412)
      expect(
        (await putManifest(manifestFor(s), { 'if-none-match': '*' })).status,
      ).toBe(200)
      expect(
        (await putManifest(manifestFor(s), { 'if-none-match': '*' })).status,
      ).toBe(412)
    })

    it('gives 412 to a stale If-Match and lets the fresh one through', async () => {
      const s1 = await makeSnapshot('1')
      const s2 = await makeSnapshot('2')
      const s3 = await makeSnapshot('3')
      for (const s of [s1, s2, s3]) await putSnap(s)

      const created = await putManifest(manifestFor(s1), {
        'if-none-match': '*',
      })
      const stale = created.headers.get('etag')!
      const moved = await putManifest(manifestFor(s2), { 'if-match': stale })
      expect(moved.status).toBe(200)

      const loser = await putManifest(manifestFor(s3), { 'if-match': stale })
      expect(loser.status).toBe(412)
      expect((await getManifest())['key']).toBe(s2.key)

      const fresh = await putManifest(manifestFor(s3), {
        'if-match': moved.headers.get('etag')!,
      })
      expect(fresh.status).toBe(200)
    })

    it('rejects ambiguous or malformed preconditions', async () => {
      const s = await makeSnapshot()
      await putSnap(s)
      const both = { 'if-match': '"x"', 'if-none-match': '*' }
      expect((await putManifest(manifestFor(s), both)).status).toBe(400)
      expect(
        (await putManifest(manifestFor(s), { 'if-none-match': '"x"' })).status,
      ).toBe(400)
      expect(
        (await putManifest(manifestFor(s), { 'if-match': '*' })).status,
      ).toBe(400)
    })
  })

  describe('validation', () => {
    it('rejects bad manifests with 422 and writes nothing', async () => {
      const s = await makeSnapshot()
      await putSnap(s)
      const other = await makeSnapshot('other')
      const bad: [string, unknown][] = [
        ['not an object', []],
        ['version', manifestFor(s, { version: 2 })],
        ['key shape', manifestFor(s, { key: 'manifest.json' })],
        ['sha256 shape', manifestFor(s, { sha256: 'abc' })],
        [
          'key not derived from sha256',
          manifestFor(s, { sha256: other.sha256 }),
        ],
        ['negative size', manifestFor(s, { size: -1 })],
        ['fractional size', manifestFor(s, { size: 1.5 })],
        ['counts missing', manifestFor(s, { counts: { issues: 1 } })],
        [
          'counts not integers',
          manifestFor(s, { counts: { issues: '1', comments: 0 } }),
        ],
        ['head', manifestFor(s, { head: 'has space' })],
        ['created_at', manifestFor(s, { created_at: 'yesterday' })],
        [
          'size differs from the stored snapshot',
          manifestFor(s, { size: s.bytes.length + 1 }),
        ],
      ]
      for (const [name, body] of bad) {
        const res = await putManifest(body, { 'if-none-match': '*' })
        expect(res.status, name).toBe(422)
      }
      const notJson = await call('/manifest', {
        method: 'PUT',
        body: '{nope',
        headers: { ...bearer(WRITE), 'if-none-match': '*' },
      })
      expect(notJson.status).toBe(422)
      expect(await env.SNAP.head('manifest.json')).toBeNull()
    })

    it('rejects a manifest whose snapshot is not in the bucket', async () => {
      const s = await makeSnapshot()
      const res = await putManifest(manifestFor(s), { 'if-none-match': '*' })
      expect(res.status).toBe(422)
      expect(await env.SNAP.head('manifest.json')).toBeNull()
    })

    it('stores only the known fields', async () => {
      const s = await makeSnapshot()
      await putSnap(s)
      await putManifest(manifestFor(s, { extra: 'x'.repeat(100) }), {
        'if-none-match': '*',
      })
      expect(Object.keys(await getManifest()).sort()).toEqual([
        'counts',
        'created_at',
        'head',
        'key',
        'sha256',
        'size',
        'version',
      ])
    })

    it('rejects an oversized manifest', async () => {
      const s = await makeSnapshot()
      await putSnap(s)
      const res = await putManifest(
        manifestFor(s, { head: 'a'.repeat(10_000) }),
        {
          'if-none-match': '*',
        },
      )
      expect(res.status).toBe(413)
    })
  })
})
