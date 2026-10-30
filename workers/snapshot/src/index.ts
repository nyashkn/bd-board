// Read-only snapshot server for bd-board. The writer (scripts/publish-snapshot.ts) uploads
// immutable `snap-<sha256 prefix>.jsonl.gz` objects, then moves `manifest.json` with a
// compare-and-swap. Readers poll GET /manifest (ETag/304) and fetch the snapshot it names.

export interface Env {
  SNAP: R2Bucket
  READ_TOKEN?: string
  WRITE_TOKEN?: string
}

const MANIFEST_KEY = 'manifest.json'
const SNAP_KEY = /^snap-([0-9a-f]{16,64})\.jsonl\.gz$/
const SHA256 = /^[0-9a-f]{64}$/
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024
const MAX_MANIFEST_BYTES = 4 * 1024

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...headers,
    },
  })

const bytesToHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

// Compare SHA-256 digests so the comparison is constant time and length does not leak.
async function tokenMatches(req: Request, secret: string | undefined) {
  // Fail closed: an unset or empty secret must never match (not even "Bearer undefined").
  if (!secret?.trim()) return false
  const given =
    /^Bearer +(.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1] ?? ''
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(secret)),
  ])
  return crypto.subtle.timingSafeEqual(a, b)
}

// The write token also reads: the writer needs the current manifest ETag.
const canRead = async (req: Request, env: Env) =>
  (await tokenMatches(req, env.READ_TOKEN)) ||
  (await tokenMatches(req, env.WRITE_TOKEN))

const unauthorized = () =>
  json({ error: 'unauthorized' }, 401, { 'www-authenticate': 'Bearer' })

// R2 conditionals take a bare etag. shortcut: only the first tag of a list is checked,
// so a multi-tag If-None-Match can get a 200 where a 304 was possible, never the reverse.
const bareEtag = (header: string | null) =>
  header?.split(',')[0]?.trim().replace(/^W\//, '').replace(/^"|"$/g, '') ||
  undefined

// R2 answers a failed `onlyIf` on get() with metadata only (no body). That is our 304.
async function serve(
  req: Request,
  env: Env,
  key: string,
  cacheControl: string,
  type: string,
) {
  const etag = bareEtag(req.headers.get('if-none-match'))
  const object = await env.SNAP.get(
    key,
    etag && etag !== '*' ? { onlyIf: { etagDoesNotMatch: etag } } : undefined,
  )
  if (!object) return json({ error: 'not found' }, 404)
  const headers = { etag: object.httpEtag, 'cache-control': cacheControl }
  if (!('body' in object)) return new Response(null, { status: 304, headers })
  return new Response(object.body, {
    headers: {
      ...headers,
      'content-type': type,
      'content-length': String(object.size),
      'x-content-type-options': 'nosniff',
    },
  })
}

// Require a numeric Content-Length so the size caps always apply (a chunked body would skip them).
const declaredLength = (req: Request) => {
  const v = req.headers.get('content-length')
  return v !== null && /^\d+$/.test(v) ? Number(v) : null
}

async function putSnapshot(
  req: Request,
  env: Env,
  key: string,
  hexLen: number,
) {
  const declared = declaredLength(req)
  if (declared === null) return json({ error: 'content-length required' }, 411)
  if (declared > MAX_SNAPSHOT_BYTES) return json({ error: 'too large' }, 413)
  const bytes = await req.arrayBuffer()
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES)
    return json({ error: 'too large' }, 413)
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength))
  if (head[0] !== 0x1f || head[1] !== 0x8b)
    return json({ error: 'not gzip' }, 400)
  const sha256 = bytesToHex(await crypto.subtle.digest('SHA-256', bytes))
  if (key !== `snap-${sha256.slice(0, hexLen)}.jsonl.gz`)
    return json({ error: 'key does not match body sha256' }, 422)
  // Content-addressed and immutable: store only if absent. A null result means it already exists.
  const stored = await env.SNAP.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: { sha256 },
  })
  return stored
    ? json({ key, created: true }, 201, { etag: stored.httpEtag })
    : json({ key, created: false })
}

const isCount = (v: unknown): v is number =>
  Number.isSafeInteger(v) && (v as number) >= 0
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

interface Manifest {
  version: 1
  key: string
  sha256: string
  size: number
  counts: { issues: number; comments: number }
  head: string
  created_at: string
}

function parseManifest(text: string): Manifest | string {
  let m: unknown
  try {
    m = JSON.parse(text)
  } catch {
    return 'manifest is not valid JSON'
  }
  if (!isRecord(m)) return 'manifest must be an object'
  const { version, key, sha256, size, counts, head, created_at } = m
  if (version !== 1) return 'version must be 1'
  const keyHex = typeof key === 'string' ? SNAP_KEY.exec(key)?.[1] : undefined
  if (!keyHex) return 'key must be a snapshot key'
  if (typeof sha256 !== 'string' || !SHA256.test(sha256))
    return 'sha256 must be 64 hex chars'
  if (!sha256.startsWith(keyHex)) return 'key must be derived from sha256'
  if (!isCount(size)) return 'size must be a non-negative integer'
  if (
    !isRecord(counts) ||
    !isCount(counts['issues']) ||
    !isCount(counts['comments'])
  )
    return 'counts needs integer issues and comments'
  if (typeof head !== 'string' || !/^[\w.-]{1,128}$/.test(head))
    return 'head must be 1-128 chars of [A-Za-z0-9_.-]'
  if (
    typeof created_at !== 'string' ||
    created_at.length > 40 ||
    Number.isNaN(Date.parse(created_at))
  )
    return 'created_at must be a timestamp'
  return {
    version,
    key: key as string,
    sha256,
    size,
    counts: { issues: counts['issues'], comments: counts['comments'] },
    head,
    created_at,
  }
}

// Compare-and-swap on the manifest: If-Match <etag> to replace, If-None-Match: * to create.
async function putManifest(req: Request, env: Env) {
  const ifMatch = req.headers.get('if-match')
  const ifNoneMatch = req.headers.get('if-none-match')
  if (ifMatch === null && ifNoneMatch === null)
    return json({ error: 'If-Match or If-None-Match: * required' }, 428)
  if (ifMatch !== null && ifNoneMatch !== null)
    return json({ error: 'send only one precondition' }, 400)
  if (ifNoneMatch !== null && ifNoneMatch.trim() !== '*')
    return json({ error: 'If-None-Match must be *' }, 400)
  const expected = ifMatch === null ? undefined : bareEtag(ifMatch)
  if (ifMatch !== null && (!expected || expected === '*'))
    return json({ error: 'If-Match must be an etag' }, 400)

  const declared = declaredLength(req)
  if (declared === null) return json({ error: 'content-length required' }, 411)
  if (declared > MAX_MANIFEST_BYTES) return json({ error: 'too large' }, 413)
  const text = await req.text()
  if (text.length > MAX_MANIFEST_BYTES) return json({ error: 'too large' }, 413)
  const manifest = parseManifest(text)
  if (typeof manifest === 'string') return json({ error: manifest }, 422)

  const snapshot = await env.SNAP.head(manifest.key)
  if (!snapshot) return json({ error: 'snapshot key does not exist' }, 422)
  // The sha256 recorded when the snapshot was accepted ties the manifest to verified content.
  if (snapshot.customMetadata?.['sha256'] !== manifest.sha256)
    return json({ error: 'sha256 does not match the stored snapshot' }, 422)
  if (snapshot.size !== manifest.size)
    return json({ error: 'size does not match the stored snapshot' }, 422)

  const stored = await env.SNAP.put(MANIFEST_KEY, JSON.stringify(manifest), {
    onlyIf: expected ? { etagMatches: expected } : { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: 'application/json' },
  })
  if (!stored)
    return json({ error: 'manifest changed, re-read and retry' }, 412)
  return json({ ok: true }, 200, { etag: stored.httpEtag })
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url)
    const { method } = req

    if (method === 'GET' && pathname === '/manifest') {
      if (!(await canRead(req, env))) return unauthorized()
      return serve(
        req,
        env,
        MANIFEST_KEY,
        'private, no-cache',
        'application/json',
      )
    }

    const snap = pathname.startsWith('/snap/')
      ? pathname.slice('/snap/'.length)
      : undefined
    if (snap !== undefined && (method === 'GET' || method === 'PUT')) {
      const writing = method === 'PUT'
      if (
        !(writing
          ? await tokenMatches(req, env.WRITE_TOKEN)
          : await canRead(req, env))
      )
        return unauthorized()
      const hex = SNAP_KEY.exec(snap)?.[1]
      if (!hex) return json({ error: 'bad snapshot key' }, 400)
      return writing
        ? putSnapshot(req, env, snap, hex.length)
        : serve(
            req,
            env,
            snap,
            'private, max-age=31536000, immutable',
            'application/gzip',
          )
    }

    if (method === 'PUT' && pathname === '/manifest') {
      if (!(await tokenMatches(req, env.WRITE_TOKEN))) return unauthorized()
      return putManifest(req, env)
    }

    return json({ error: 'not found' }, 404)
  },
}
