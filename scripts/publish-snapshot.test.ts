import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  buildManifest,
  countExport,
  endpoint,
  publish,
  shouldPublish,
} from './publish-snapshot.ts'
import type { Manifest } from './publish-snapshot.ts'

// Synthetic export lines; shapes follow `bd export`, content is made up.
const line = (o: object) => JSON.stringify(o)
const EXPORT = Buffer.from(
  [
    line({
      _type: 'issue',
      id: 'x-1',
      title: 'one',
      comments: [{ text: 'a' }, { text: 'b' }],
    }),
    line({ _type: 'issue', id: 'x-2', title: 'two', comment_count: 1 }),
    line({ _type: 'memory', key: 'k', value: 'v' }),
    line({ id: 'x-3', title: 'untyped' }),
    '',
  ].join('\n'),
)
const NOW = new Date('2026-01-02T03:04:05.000Z')

describe('countExport', () => {
  it('counts issues and comments and skips other record types', () => {
    expect(countExport(EXPORT)).toEqual({ issues: 3, comments: 3 })
  })
})

describe('buildManifest', () => {
  it('derives key, sha256, size and counts from the gzipped bytes', () => {
    const { manifest, gz } = buildManifest({
      jsonl: EXPORT,
      head: 'dolt-head_1',
      now: NOW,
    })
    expect(gunzipSync(gz)).toEqual(EXPORT)
    expect(manifest).toMatchObject({
      version: 1,
      size: gz.length,
      counts: { issues: 3, comments: 3 },
      head: 'dolt-head_1',
      created_at: '2026-01-02T03:04:05.000Z',
    })
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.key).toBe(`snap-${manifest.sha256.slice(0, 16)}.jsonl.gz`)
  })

  it('is deterministic for the same export', () => {
    const a = buildManifest({ jsonl: EXPORT, now: NOW }).manifest
    const b = buildManifest({
      jsonl: EXPORT,
      now: new Date(NOW.getTime() + 1000),
    }).manifest
    expect(a.sha256).toBe(b.sha256)
  })

  it('falls back to the sha256 when there is no usable head', () => {
    for (const head of [undefined, '', 'has space', 'x'.repeat(200)]) {
      const { manifest } = buildManifest({ jsonl: EXPORT, head, now: NOW })
      expect(manifest.head).toBe(manifest.sha256)
    }
  })
})

describe('shouldPublish', () => {
  it('publishes when there is no manifest or the sha256 differs', () => {
    expect(shouldPublish(null, { sha256: 'a' })).toBe(true)
    expect(shouldPublish({ sha256: 'a' }, { sha256: 'b' })).toBe(true)
    expect(shouldPublish({ sha256: 'a' }, { sha256: 'a' })).toBe(false)
  })
})

describe('endpoint', () => {
  it('requires https except on loopback', () => {
    expect(() => endpoint('http://example.com')).toThrow(/https/)
    expect(endpoint('https://example.com/base')('manifest')).toBe(
      'https://example.com/base/manifest',
    )
    expect(endpoint('http://127.0.0.1:8787')('snap/k')).toBe(
      'http://127.0.0.1:8787/snap/k',
    )
  })
})

// A tiny in-memory stand-in for the Worker: records every call.
function fakeWorker(initial?: { manifest: Manifest; etag: string }) {
  const calls: {
    method: string
    path: string
    headers: Headers
    body?: string
  }[] = []
  let current = initial
  const snaps = new Set<string>()
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const headers = new Headers(init?.headers)
    calls.push({
      method,
      path: url.pathname,
      headers,
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    if (method === 'GET' && url.pathname === '/manifest') {
      return current
        ? new Response(JSON.stringify(current.manifest), {
            headers: { etag: current.etag },
          })
        : new Response('{"error":"not found"}', { status: 404 })
    }
    if (method === 'PUT' && url.pathname.startsWith('/snap/')) {
      const key = url.pathname.slice(6)
      const created = !snaps.has(key)
      snaps.add(key)
      return new Response('{}', { status: created ? 201 : 200 })
    }
    if (method === 'PUT' && url.pathname === '/manifest') {
      const ok = current
        ? headers.get('if-match') === current.etag
        : headers.get('if-none-match') === '*'
      if (!ok) return new Response('{}', { status: 412 })
      current = {
        manifest: JSON.parse(String(init?.body)) as Manifest,
        etag: '"next"',
      }
      return new Response('{}', { headers: { etag: current.etag } })
    }
    return new Response('?', { status: 500 })
  }
  return { calls, fetchImpl }
}

const base = {
  baseUrl: 'https://example.com',
  token: 'secret-token',
  now: () => NOW,
}

describe('publish', () => {
  it('uploads the snapshot, then creates the manifest with If-None-Match: *', async () => {
    const { calls, fetchImpl } = fakeWorker()
    const lines: string[] = []
    const res = await publish({
      ...base,
      jsonl: EXPORT,
      fetch: fetchImpl,
      log: (l) => lines.push(l),
    })
    expect(res.status).toBe('published')
    expect(
      calls.map(
        (c) =>
          `${c.method} ${c.path.startsWith('/snap/') ? '/snap/*' : c.path}`,
      ),
    ).toEqual(['GET /manifest', 'PUT /snap/*', 'PUT /manifest'])
    expect(calls[2].headers.get('if-none-match')).toBe('*')
    expect(
      calls.every(
        (c) => c.headers.get('authorization') === 'Bearer secret-token',
      ),
    ).toBe(true)
    expect(lines.join('\n')).not.toContain('secret-token')
  })

  it('replaces an existing manifest with If-Match and its etag', async () => {
    const old = buildManifest({
      jsonl: Buffer.from('{"id":"old"}\n'),
      now: NOW,
    }).manifest
    const { calls, fetchImpl } = fakeWorker({ manifest: old, etag: '"v1"' })
    const res = await publish({ ...base, jsonl: EXPORT, fetch: fetchImpl })
    expect(res.status).toBe('published')
    expect(calls[2].headers.get('if-match')).toBe('"v1"')
  })

  it('does nothing when the content matches the current manifest', async () => {
    const same = buildManifest({ jsonl: EXPORT, now: NOW }).manifest
    const { calls, fetchImpl } = fakeWorker({ manifest: same, etag: '"v1"' })
    const res = await publish({ ...base, jsonl: EXPORT, fetch: fetchImpl })
    expect(res.status).toBe('unchanged')
    expect(calls.map((c) => c.method)).toEqual(['GET'])
  })

  it('writes nothing on --dry-run', async () => {
    const { calls, fetchImpl } = fakeWorker()
    const lines: string[] = []
    const res = await publish({
      ...base,
      jsonl: EXPORT,
      fetch: fetchImpl,
      dryRun: true,
      log: (l) => lines.push(l),
    })
    expect(res.status).toBe('dry-run')
    expect(calls.map((c) => c.method)).toEqual(['GET'])
    expect(lines[0]).toMatch(/would PUT snap-/)
  })

  it('fails with a retry hint when the manifest moved underneath', async () => {
    const { fetchImpl } = fakeWorker()
    const racing: typeof fetch = async (input, init) => {
      const res = await fetchImpl(input, init)
      return init?.method === 'PUT' &&
        new URL(String(input)).pathname === '/manifest'
        ? new Response('{}', { status: 412 })
        : res
    }
    await expect(
      publish({ ...base, jsonl: EXPORT, fetch: racing }),
    ).rejects.toThrow(/rerun/)
  })

  it('surfaces a server error without leaking the token', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('{"error":"unauthorized"}', { status: 401 })
    const err = await publish({
      ...base,
      jsonl: EXPORT,
      fetch: fetchImpl,
    }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/HTTP 401/)
    expect((err as Error).message).not.toContain('secret-token')
  })
})
