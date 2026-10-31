import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'

import type { AddressInfo } from 'node:net'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { exportText } from './snapshot-fixture.ts'
import { isConnectionError } from './connectors/select.ts'
import { parseRegistryEntry, RegistryError } from './registry.ts'
import {
  createHttpSnapshotClient,
  MAX_SNAPSHOT_BYTES,
  readHttpSnapshot,
} from './http-snapshot.ts'

vi.mock('./registry.ts', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadRegistry: vi.fn(),
}))

const TOKEN = 'tok-SECRET-123'
const SOURCE = 'https://snap.example.com/manifest.json'
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

function pack(jsonl: string | Buffer, over: Record<string, unknown> = {}) {
  const gz = gzipSync(jsonl)
  const sha256 = sha(gz)
  const manifest = {
    version: 1,
    key: `snap-${sha256.slice(0, 16)}.jsonl.gz`,
    sha256,
    size: gz.length,
    counts: { issues: 1, comments: 0 },
    head: 'head1',
    created_at: '2026-01-02T00:00:00.000Z',
    ...over,
  }
  return { gz, manifest }
}

const reply = (body: BodyInit | null, status = 200, headers = {}) =>
  new Response(body, { status, headers })

/** A fake Worker: serves `current` as manifest/snapshot and honours If-None-Match. */
function worker(initial: ReturnType<typeof pack>) {
  let current = initial
  let tag = 1
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    if (url.endsWith('/manifest')) {
      if (headers.get('if-none-match') === `"${tag}"`)
        return reply(null, 304, { etag: `"${tag}"` })
      return reply(JSON.stringify(current.manifest), 200, { etag: `"${tag}"` })
    }
    return reply(new Uint8Array(current.gz))
  })
  return {
    fetchMock,
    publish(next: ReturnType<typeof pack>) {
      current = next
      tag++
    },
  }
}

const client = (fetchMock: typeof fetch) =>
  createHttpSnapshotClient({ source: SOURCE, token: TOKEN, fetch: fetchMock })

const failure = async (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected a rejection')
    },
    (e: unknown) => e as Error,
  )

describe('http-snapshot client', () => {
  it('fetches on 200, reuses the cache on 304, and parses the snapshot', async () => {
    const w = worker(pack(exportText))
    const c = client(w.fetchMock as unknown as typeof fetch)
    const first = await c.refresh()
    expect(first.beads.length).toBeGreaterThan(0)
    expect(first.cursor).toBe('head1')
    expect(first.ready).toBeNull()
    expect(first.blocked).toBeNull()
    const urls = w.fetchMock.mock.calls.map((x) => x[0])
    expect(urls).toEqual([
      'https://snap.example.com/manifest',
      expect.stringMatching(/^https:\/\/snap\.example\.com\/snap\/snap-/),
    ])

    const second = await c.refresh()
    expect(second).toBe(first)
    expect(w.fetchMock).toHaveBeenCalledTimes(3) // one more manifest request, no snapshot
    const init = w.fetchMock.mock.calls[2][1] as RequestInit
    expect(new Headers(init.headers).get('if-none-match')).toBe('"1"')
    expect(init.redirect).toBe('error')
    expect(new Headers(init.headers).get('authorization')).toBe(
      `Bearer ${TOKEN}`,
    )
  })

  it('refetches when the manifest changes', async () => {
    const w = worker(pack(exportText))
    const c = client(w.fetchMock as unknown as typeof fetch)
    const first = await c.refresh()
    w.publish(
      pack(exportText + '\n', {
        head: 'head2',
        created_at: '2026-01-03T00:00:00.000Z',
      }),
    )
    const next = await c.refresh()
    expect(next).not.toBe(first)
    expect(next.cursor).toBe('head2')
  })

  it('skips non-issue records', async () => {
    const memory = JSON.stringify({ _type: 'memory', key: 'k', value: 'v' })
    const w = worker(pack(`${memory}\n${exportText}`))
    const snap = await client(w.fetchMock as unknown as typeof fetch).refresh()
    const plain = await client(
      worker(pack(exportText)).fetchMock as unknown as typeof fetch,
    ).refresh()
    expect(snap.beads).toHaveLength(plain.beads.length)
  })

  it('rejects a sha256 mismatch', async () => {
    const p = pack(exportText)
    const other = pack('{"id":"x"}')
    const w = worker({
      gz: p.gz,
      manifest: {
        ...p.manifest,
        sha256: other.manifest.sha256,
        key: other.manifest.key,
      },
    })
    const err = await failure(
      client(w.fetchMock as unknown as typeof fetch).refresh(),
    )
    expect(err.message).toMatch(/sha256 does not match/)
  })

  it('rejects a size mismatch, short or long', async () => {
    const p = pack(exportText)
    for (const size of [p.gz.length + 1, p.gz.length - 1]) {
      const w = worker({ gz: p.gz, manifest: { ...p.manifest, size } })
      const err = await failure(
        client(w.fetchMock as unknown as typeof fetch).refresh(),
      )
      expect(err.message).toMatch(/size|larger/)
    }
  })

  it('caps the decompressed size (gzip bomb)', async () => {
    const bomb = pack(Buffer.alloc(MAX_SNAPSHOT_BYTES + 1024 * 1024))
    expect(bomb.gz.length).toBeLessThan(1024 * 1024)
    const w = worker(bomb)
    const err = await failure(
      client(w.fetchMock as unknown as typeof fetch).refresh(),
    )
    expect(err.message).toMatch(/content is larger/)
  })

  it('keeps the cached snapshot when the manifest goes backwards (replay)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const w = worker(
      pack(exportText, { created_at: '2026-01-05T00:00:00.000Z' }),
    )
    const c = client(w.fetchMock as unknown as typeof fetch)
    const first = await c.refresh()
    w.publish(
      pack(exportText + '\n', {
        head: 'old',
        created_at: '2026-01-04T00:00:00.000Z',
      }),
    )
    // Served from the cache every time, not an error that never clears.
    expect(await c.refresh()).toBe(first)
    expect(await c.refresh()).toBe(first)
    expect(first.cursor).toBe('head1')
    expect(warn).toHaveBeenCalled()
    // A newer manifest moves on again.
    w.publish(
      pack(exportText + '\n', {
        head: 'new',
        created_at: '2026-01-06T00:00:00.000Z',
      }),
    )
    expect((await c.refresh()).cursor).toBe('new')
    warn.mockRestore()
  })

  it.each([
    ['a path traversal', '../snap-0123456789abcdef.jsonl.gz'],
    ['a nested path', 'x/snap-0123456789abcdef.jsonl.gz'],
    [
      'an absolute URL',
      'https://evil.example.com/snap-0123456789abcdef.jsonl.gz',
    ],
    ['a query', 'snap-0123456789abcdef.jsonl.gz?x=1'],
  ])('rejects a manifest key with %s, without fetching it', async (_n, key) => {
    const p = pack(exportText)
    const w = worker({ gz: p.gz, manifest: { ...p.manifest, key } })
    const err = await failure(
      client(w.fetchMock as unknown as typeof fetch).refresh(),
    )
    expect(err.message).toMatch(/unexpected shape/)
    expect(w.fetchMock).toHaveBeenCalledTimes(1) // the manifest only
  })

  it('requires the key to be a prefix of the sha256', async () => {
    const p = pack(exportText)
    const key = `snap-${'0'.repeat(16)}.jsonl.gz`
    expect(p.manifest.sha256.startsWith('0'.repeat(16))).toBe(false)
    const w = worker({ gz: p.gz, manifest: { ...p.manifest, key } })
    const err = await failure(
      client(w.fetchMock as unknown as typeof fetch).refresh(),
    )
    expect(err.message).toMatch(/unexpected shape/)
    // A longer prefix of the same sha256 is fine.
    const ok = worker({
      gz: p.gz,
      manifest: {
        ...p.manifest,
        key: `snap-${p.manifest.sha256.slice(0, 32)}.jsonl.gz`,
      },
    })
    await client(ok.fetchMock as unknown as typeof fetch).refresh()
  })

  it('a body that dies mid-way is connection-class', async () => {
    const p = pack(exportText)
    const dying = new ReadableStream<Uint8Array>({
      start(ctl) {
        ctl.enqueue(p.gz.subarray(0, 10))
        ctl.error(new Error(`socket closed ${TOKEN}`))
      },
    })
    const f = vi.fn(async (url: string) =>
      url.endsWith('/manifest')
        ? reply(JSON.stringify(p.manifest))
        : reply(dying),
    )
    const err = await failure(client(f as unknown as typeof fetch).refresh())
    expect(isConnectionError(err)).toBe(true)
    expect(err.message).not.toContain(TOKEN)
  })

  it('names an invalid line by number only', async () => {
    const w = worker(pack(`${exportText}\n{"secret": nope ${TOKEN}`))
    const err = await failure(
      client(w.fetchMock as unknown as typeof fetch).refresh(),
    )
    expect(err.message).toMatch(/^snapshot has an invalid line \d+$/)
    expect(err.message).not.toContain('nope')
  })

  it('asks for identity encoding and refuses a content-encoded body', async () => {
    const p = pack(exportText)
    const w = worker(p)
    await client(w.fetchMock as unknown as typeof fetch).refresh()
    const snapInit = w.fetchMock.mock.calls[1][1] as RequestInit
    expect(new Headers(snapInit.headers).get('accept-encoding')).toBe(
      'identity',
    )

    const f = vi.fn(async (url: string) =>
      url.endsWith('/manifest')
        ? reply(JSON.stringify(p.manifest))
        : reply(new Uint8Array(p.gz), 200, { 'content-encoding': 'gzip' }),
    )
    const err = await failure(client(f as unknown as typeof fetch).refresh())
    expect(err.message).toMatch(/content-encoding/)
  })

  it('works through the real fetch (undici) and refuses a gzip content-encoding', async () => {
    const p = pack(exportText)
    let encode = false
    const seen: Array<string | undefined> = []
    const srv = createServer((req, res) => {
      if (req.url === '/manifest') {
        res.setHeader('content-type', 'application/json')
        return void res.end(JSON.stringify(p.manifest))
      }
      seen.push(req.headers['accept-encoding'])
      res.setHeader('content-type', 'application/gzip')
      if (encode) res.setHeader('content-encoding', 'gzip')
      res.end(p.gz)
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const { port } = srv.address() as AddressInfo
    const source = `http://127.0.0.1:${port}/manifest.json`
    try {
      const ok = await createHttpSnapshotClient({
        source,
        token: TOKEN,
      }).refresh()
      expect(ok.beads.length).toBeGreaterThan(0)
      expect(seen[0]).toBe('identity')
      encode = true
      const err = await failure(
        createHttpSnapshotClient({ source, token: TOKEN }).refresh(),
      )
      // undici inflated the body, so it is no longer the bytes the manifest hashed.
      expect(err.message).toMatch(/content-encoding/)
    } finally {
      srv.close()
    }
  })

  it('rejects a malformed manifest', async () => {
    const f = vi.fn(async () => reply('{"version":2}'))
    const err = await failure(client(f).refresh())
    expect(err.message).toMatch(/unexpected shape/)
  })

  it('401 is a clear, non-connection error', async () => {
    const f = vi.fn(async () => reply('{"error":"unauthorized"}', 401))
    const err = await failure(client(f).refresh())
    expect(err.message).toMatch(/snapshot token rejected/)
    expect(isConnectionError(err)).toBe(false)
  })

  it('5xx and network errors are connection-class', async () => {
    const f5 = vi.fn(async () => reply('oops', 503))
    const e5 = await failure(client(f5).refresh())
    expect(isConnectionError(e5)).toBe(true)
    const fn = vi.fn(async () => {
      throw new TypeError(`fetch failed for Bearer ${TOKEN}`)
    })
    const en = await failure(client(fn).refresh())
    expect(isConnectionError(en)).toBe(true)
  })

  it('never puts the token in an error', async () => {
    const p = pack(exportText)
    const cases: Array<[typeof fetch, string]> = []
    for (const status of [401, 403, 404, 500, 503])
      cases.push([
        async () => reply(`echo ${TOKEN}`, status),
        `status ${status}`,
      ])
    cases.push([
      async () => {
        throw new Error(`boom ${TOKEN}`)
      },
      'throw',
    ])
    cases.push([
      worker({ gz: p.gz, manifest: { ...p.manifest, size: 1 } })
        .fetchMock as unknown as typeof fetch,
      'size',
    ])
    for (const [f, label] of cases) {
      const err = await failure(client(f).refresh())
      expect(err.message, label).not.toContain(TOKEN)
      expect(String(err.stack), label).not.toContain(TOKEN)
    }
  })
})

describe('registry credentials_ref', () => {
  const base = { id: 'a', path: '/p', label: 'A' }
  it('keeps an env var name', () => {
    expect(
      parseRegistryEntry(
        { ...base, credentials_ref: 'BD_BOARD_SNAPSHOT_TOKEN' },
        0,
      ),
    ).toMatchObject({ credentials_ref: 'BD_BOARD_SNAPSHOT_TOKEN' })
  })
  it.each([
    'a b',
    'tok-1',
    '',
    7,
    'AWS_SECRET_ACCESS_KEY',
    'SNAP_TOKEN',
    'BD_BOARD_SNAPSHOT_',
    'bd_board_snapshot_x',
    'BD_BOARD_SNAPSHOT_a-b',
  ])('rejects %j without echoing it', (bad) => {
    const run = () => parseRegistryEntry({ ...base, credentials_ref: bad }, 0)
    expect(run).toThrow(RegistryError)
    expect(run).toThrow(/environment variable name/)
    // The message names the required prefix, so skip inputs that are only that prefix.
    if (typeof bad === 'string' && bad && !bad.startsWith('BD_BOARD_SNAPSHOT_'))
      expect(run).not.toThrow(bad)
  })
})

describe('readHttpSnapshot (server side)', () => {
  beforeEach(async () => {
    const { loadRegistry } = await import('./registry.ts')
    vi.mocked(loadRegistry).mockResolvedValue([
      { ...{ id: 'p', path: '/p', label: 'P' }, sources: [SOURCE] },
      {
        id: 'q',
        path: '/q',
        label: 'Q',
        sources: [SOURCE],
        credentials_ref: 'BD_BOARD_SNAPSHOT_TEST_TOKEN',
      },
    ])
    delete process.env['BD_BOARD_SNAPSHOT_TEST_TOKEN']
  })

  it('only fetches a source the registry lists', async () => {
    const err = await failure(
      readHttpSnapshot('q', 'https://evil.example.com/manifest.json', false),
    )
    expect(err.message).toMatch(/unknown snapshot source/)
  })

  it('needs credentials_ref, and the variable must be set', async () => {
    expect(
      (await failure(readHttpSnapshot('p', SOURCE, false))).message,
    ).toMatch(/credentials_ref/)
    const err = await failure(readHttpSnapshot('q', SOURCE, false))
    expect(err.message).toMatch(/BD_BOARD_SNAPSHOT_TEST_TOKEN is not set/)
  })

  it('reads the token from the environment and peeks without the snapshot', async () => {
    process.env['BD_BOARD_SNAPSHOT_TEST_TOKEN'] = TOKEN
    const w = worker(pack(exportText))
    vi.stubGlobal('fetch', w.fetchMock)
    try {
      const peek = await readHttpSnapshot('q', SOURCE, true)
      expect(peek).toEqual({ cursor: 'head1' })
      const full = await readHttpSnapshot('q', SOURCE, false)
      expect(full.snapshot?.beads.length).toBeGreaterThan(0)
      const init = w.fetchMock.mock.calls[0][1] as RequestInit
      expect(new Headers(init.headers).get('authorization')).toBe(
        `Bearer ${TOKEN}`,
      )
    } finally {
      vi.unstubAllGlobals()
      delete process.env['BD_BOARD_SNAPSHOT_TEST_TOKEN']
    }
  })
})
