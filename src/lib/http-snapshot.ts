import { buildSnapshot } from './bd.ts'
import { loadRegistry } from './registry.ts'

import type { ProjectSnapshot } from './snapshot.ts'

/**
 * Server side of the read-only `http-snapshot` connector: it talks to the snapshot Worker
 * (workers/snapshot). It runs on the server (or any runtime with fetch), so the reader token never
 * reaches the browser, and the Worker needs no CORS. Errors never carry the token or a URL.
 */

export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const MAX_MANIFEST_BYTES = 4 * 1024
const TIMEOUT_MS = 20_000
const SNAP_KEY = /^snap-[0-9a-f]{16,64}\.jsonl\.gz$/
const SHA256 = /^[0-9a-f]{64}$/

export interface SnapshotManifest {
  version: 1
  key: string
  sha256: string
  size: number
  counts: { issues: number; comments: number }
  head: string
  created_at: string
}

/** Connection class by wording: see CONNECTION_TEXT in connectors/select.ts. */
const unavailable = (why: string) =>
  new Error(`snapshot source unavailable: ${why}`)

function checkStatus(res: Response, what: string): void {
  if (res.status === 401 || res.status === 403)
    throw new Error(
      'snapshot token rejected (HTTP 401): check the token behind credentials_ref',
    )
  if (res.status >= 500)
    throw unavailable(`${what} answered HTTP ${res.status}`)
  if (res.status !== 200 && res.status !== 304)
    throw new Error(`snapshot ${what} request failed (HTTP ${res.status})`)
}

/** Reads a stream, giving up (and cancelling it) once it passes `limit` bytes. */
async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  what: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  const reader = stream?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      throw new Error(`snapshot ${what} is larger than ${limit} bytes`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export function parseManifest(text: string): SnapshotManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('snapshot manifest is not valid JSON')
  }
  const m = (typeof parsed === 'object' && parsed ? parsed : {}) as Record<
    string,
    unknown
  >
  const { version, key, sha256, size, head, created_at } = m
  const ok =
    version === 1 &&
    typeof key === 'string' &&
    SNAP_KEY.test(key) &&
    typeof sha256 === 'string' &&
    SHA256.test(sha256) &&
    sha256.startsWith(key.slice(5, key.indexOf('.'))) &&
    Number.isSafeInteger(size) &&
    (size as number) >= 0 &&
    typeof head === 'string' &&
    /^[\w.-]{1,128}$/.test(head) &&
    typeof created_at === 'string' &&
    !Number.isNaN(Date.parse(created_at))
  if (!ok) throw new Error('snapshot manifest has an unexpected shape')
  return m as unknown as SnapshotManifest
}

export interface HttpSnapshotClient {
  /** Conditional GET of the manifest; fetches and verifies the snapshot only when it changed. */
  refresh: () => Promise<ProjectSnapshot>
}

export function createHttpSnapshotClient(opts: {
  /** The Worker's base URL; a trailing `/manifest.json` or `/manifest` is dropped. */
  source: string
  token: string
  fetch?: typeof fetch
}): HttpSnapshotClient {
  const doFetch = opts.fetch ?? fetch
  const base = opts.source
    .replace(/\/manifest(\.json)?$/, '')
    .replace(/\/$/, '')
  let etag: string | null = null
  let manifest: SnapshotManifest | undefined
  let snapshot: ProjectSnapshot | undefined
  let inflight: Promise<ProjectSnapshot> | undefined

  async function get(path: string, extra: Record<string, string> = {}) {
    try {
      return await doFetch(`${base}${path}`, {
        // redirect 'error': a redirect must never carry the bearer token elsewhere.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { authorization: `Bearer ${opts.token}`, ...extra },
      })
    } catch {
      // The cause is dropped on purpose: it can echo the request.
      throw unavailable('network error')
    }
  }

  async function run(): Promise<ProjectSnapshot> {
    const res = await get(
      '/manifest',
      etag && snapshot ? { 'if-none-match': etag } : {},
    )
    checkStatus(res, 'manifest')
    if (res.status === 304) {
      if (snapshot) return snapshot
      throw unavailable('manifest answered 304 without a cached snapshot')
    }
    const next = parseManifest(
      new TextDecoder().decode(
        await readCapped(res.body, MAX_MANIFEST_BYTES, 'manifest'),
      ),
    )
    if (
      manifest &&
      Date.parse(next.created_at) < Date.parse(manifest.created_at)
    )
      throw new Error('snapshot manifest went backwards (possible replay)')
    const tag = res.headers.get('etag')
    if (snapshot && manifest?.sha256 === next.sha256) {
      etag = tag
      manifest = next
      return snapshot
    }
    if (next.size > MAX_SNAPSHOT_BYTES)
      throw new Error('snapshot is larger than the allowed size')

    const snap = await get(`/snap/${next.key}`)
    checkStatus(snap, 'snapshot')
    if (snap.status !== 200)
      throw new Error('snapshot request failed (unexpected 304)')
    const gz = await readCapped(snap.body, next.size, 'download')
    if (gz.byteLength !== next.size)
      throw new Error('snapshot size does not match the manifest')
    const digest = hex(
      await crypto.subtle.digest('SHA-256', gz as BufferSource),
    )
    if (digest !== next.sha256)
      throw new Error('snapshot sha256 does not match the manifest')

    // Hash first, inflate second: only bytes the manifest vouches for are decompressed, capped.
    let text: string
    try {
      const inflated = new Response(gz as BodyInit).body!.pipeThrough(
        new DecompressionStream('gzip'),
      )
      text = new TextDecoder().decode(
        await readCapped(inflated, MAX_SNAPSHOT_BYTES, 'content'),
      )
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('snapshot ')) throw err
      throw new Error('snapshot is not valid gzip')
    }
    // `bd export` can also print memory records; only issues are beads.
    const issues = text
      .split('\n')
      .filter((line) => {
        if (!line.trim()) return false
        const type = (JSON.parse(line) as { _type?: string })._type
        return type === undefined || type === 'issue'
      })
      .join('\n')
    // ready/blocked are not in a snapshot, and a derived rule disagreed with bd's on fixtures, so
    // they stay null (the UI then falls back to link-based readiness).
    snapshot = {
      ...buildSnapshot(issues, undefined, undefined),
      cursor: next.head,
    }
    etag = tag
    manifest = next
    return snapshot
  }

  return {
    refresh: () => (inflight ??= run().finally(() => (inflight = undefined))),
  }
}

// One client per project and source, so the etag, cached snapshot and replay floor survive calls.
const clients = new Map<string, { token: string; client: HttpSnapshotClient }>()

/**
 * What the server function runs. The token is looked up here, in the server's environment, from the
 * registry entry's `credentials_ref` (an env var name); the browser sends only project and source.
 */
export async function readHttpSnapshot(
  project: string,
  source: string,
  peek: boolean,
): Promise<{ cursor: string; snapshot?: ProjectSnapshot }> {
  const entry = (await loadRegistry()).find((e) => e.id === project)
  // The source must be one the registry lists: never fetch (or send a token to) a caller's URL.
  if (!entry?.sources?.includes(source))
    throw new Error('unknown snapshot source for this project')
  const ref = entry.credentials_ref
  if (!ref)
    throw new Error(
      'http-snapshot needs "credentials_ref" (the name of an environment variable holding the reader token) on the project',
    )
  const token = process.env[ref]?.trim()
  if (!token)
    throw new Error(
      `credentials_ref ${ref} is not set in the server environment`,
    )
  const id = `${project}\0${source}`
  let held = clients.get(id)
  if (held?.token !== token)
    clients.set(
      id,
      (held = { token, client: createHttpSnapshotClient({ source, token }) }),
    )
  const snapshot = await held.client.refresh()
  return peek
    ? { cursor: snapshot.cursor }
    : { cursor: snapshot.cursor, snapshot }
}
