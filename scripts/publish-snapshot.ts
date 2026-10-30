// Publish a bd project's export to the snapshot Worker (workers/snapshot).
//
//   SNAPSHOT_URL=https://snapshots.example.com SNAPSHOT_WRITE_TOKEN=... \
//     node --experimental-strip-types --no-warnings scripts/publish-snapshot.ts [--dry-run] <project-dir>
//
// bd export -> gzip -> sha256 -> PUT /snap/<key> -> GET /manifest (etag) -> PUT /manifest (If-Match).
// Nothing is uploaded when the export hashes to the sha256 the current manifest already names.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

export interface Manifest {
  version: 1
  key: string
  sha256: string
  size: number
  counts: { issues: number; comments: number }
  head: string
  created_at: string
}

export interface PublishInput {
  /** Raw `bd export` JSONL. */
  jsonl: Buffer
  /** Dolt head of the project, or undefined to fall back to the sha256. */
  head?: string
  baseUrl: string
  token: string
  dryRun?: boolean
  fetch?: typeof fetch
  now?: () => Date
  log?: (line: string) => void
}

export type PublishResult =
  | { status: 'unchanged'; manifest: Manifest }
  | { status: 'dry-run'; manifest: Manifest }
  | { status: 'published'; manifest: Manifest; etag: string | null }

const HEAD_OK = /^[\w.-]{1,128}$/

/** Count issues and comments in `bd export` JSONL (memories and other record types are skipped). */
export function countExport(jsonl: Buffer) {
  let issues = 0
  let comments = 0
  for (const line of jsonl.toString('utf8').split('\n')) {
    if (!line.trim()) continue
    const rec = JSON.parse(line) as {
      _type?: string
      comments?: unknown[]
      comment_count?: number
    }
    if (rec._type !== undefined && rec._type !== 'issue') continue
    issues++
    comments += Array.isArray(rec.comments)
      ? rec.comments.length
      : (rec.comment_count ?? 0)
  }
  return { issues, comments }
}

export function buildManifest(input: {
  jsonl: Buffer
  head?: string
  now: Date
}): { manifest: Manifest; gz: Buffer } {
  // Node's gzip writes no mtime, so the same export always gives the same bytes and key.
  const gz = gzipSync(input.jsonl, { level: 9 })
  gz[9] = 0xff // header OS byte differs per platform (zlib stamps the host OS); pin it so the sha256 is portable
  const sha256 = createHash('sha256').update(gz).digest('hex')
  return {
    gz,
    manifest: {
      version: 1,
      key: `snap-${sha256.slice(0, 16)}.jsonl.gz`,
      sha256,
      size: gz.length,
      counts: countExport(input.jsonl),
      head: input.head && HEAD_OK.test(input.head) ? input.head : sha256,
      created_at: input.now.toISOString(),
    },
  }
}

export const shouldPublish = (
  current: Pick<Manifest, 'sha256'> | null,
  next: Pick<Manifest, 'sha256'>,
) => current?.sha256 !== next.sha256

/** Plain http is only allowed for loopback, so the write token never crosses the network in clear. */
export function endpoint(baseUrl: string) {
  const url = new URL(baseUrl)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(
      'SNAPSHOT_URL must be https (http is allowed only for localhost)',
    )
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return (path: string) => new URL(path, url).toString()
}

async function failure(what: string, res: Response) {
  const body = (await res.text().catch(() => '')).slice(0, 200)
  return new Error(`${what} failed: HTTP ${res.status} ${body}`.trim())
}

export async function publish(input: PublishInput): Promise<PublishResult> {
  const doFetch = input.fetch ?? fetch
  const log = input.log ?? (() => {})
  const url = endpoint(input.baseUrl)
  const auth = { authorization: `Bearer ${input.token}` }
  const { manifest, gz } = buildManifest({
    jsonl: input.jsonl,
    head: input.head,
    now: (input.now ?? (() => new Date()))(),
  })

  const cur = await doFetch(url('manifest'), {
    headers: auth,
    redirect: 'error',
  })
  if (cur.status !== 200 && cur.status !== 404) {
    throw await failure('GET manifest', cur)
  }
  const etag = cur.status === 200 ? cur.headers.get('etag') : null
  const current = cur.status === 200 ? ((await cur.json()) as Manifest) : null
  if (cur.status === 200 && !etag)
    throw new Error('manifest response has no ETag')

  if (!shouldPublish(current, manifest)) {
    log(`unchanged: manifest already names ${current?.key}`)
    return { status: 'unchanged', manifest: current! }
  }
  const counts = `${manifest.counts.issues} issues, ${manifest.counts.comments} comments`
  if (input.dryRun) {
    log(`dry run: would PUT ${manifest.key} (${gz.length} bytes, ${counts})`)
    log(
      `dry run: would PUT manifest ${etag ? `If-Match ${etag}` : 'If-None-Match: *'}, head ${manifest.head}`,
    )
    return { status: 'dry-run', manifest }
  }

  // Snapshot first, manifest second: a reader never sees a manifest whose snapshot is missing.
  // The Worker stores the snapshot only if absent, so a retry after a failed manifest PUT is harmless.
  const snap = await doFetch(url(`snap/${manifest.key}`), {
    method: 'PUT',
    redirect: 'error',
    headers: { ...auth, 'content-type': 'application/gzip' },
    body: new Uint8Array(gz),
  })
  if (!snap.ok) throw await failure('PUT snapshot', snap)
  log(
    `snapshot ${manifest.key} ${snap.status === 201 ? 'uploaded' : 'already stored'} (${gz.length} bytes)`,
  )

  const put = await doFetch(url('manifest'), {
    method: 'PUT',
    redirect: 'error',
    headers: {
      ...auth,
      'content-type': 'application/json',
      ...(etag ? { 'if-match': etag } : { 'if-none-match': '*' }),
    },
    body: JSON.stringify(manifest),
  })
  if (put.status === 412) {
    throw new Error(
      'manifest changed while publishing (another writer?); rerun to retry',
    )
  }
  if (!put.ok) throw await failure('PUT manifest', put)
  log(`manifest now names ${manifest.key} (${counts}, head ${manifest.head})`)
  return { status: 'published', manifest, etag: put.headers.get('etag') }
}

function readHead(bd: string, cwd: string) {
  try {
    const out = execFileSync(bd, ['vc', 'status', '--json'], {
      cwd,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, SNAPSHOT_WRITE_TOKEN: undefined },
    })
    return (JSON.parse(out) as { commit?: string }).commit
  } catch {
    return undefined
  }
}

async function main(argv: string[]) {
  const dryRun = argv.includes('--dry-run')
  const dirs = argv.filter((a) => !a.startsWith('--'))
  const baseUrl = process.env['SNAPSHOT_URL']
  const token = process.env['SNAPSHOT_WRITE_TOKEN']
  if (dirs.length !== 1 || !baseUrl || !token) {
    throw new Error(
      'usage: SNAPSHOT_URL=... SNAPSHOT_WRITE_TOKEN=... publish-snapshot.ts [--dry-run] <project-dir>',
    )
  }
  const bd = process.env['BD_BIN'] || 'bd'
  const jsonl = execFileSync(bd, ['export'], {
    cwd: dirs[0],
    maxBuffer: 1024 * 1024 * 1024,
    timeout: 120_000,
    env: { ...process.env, SNAPSHOT_WRITE_TOKEN: undefined },
  })
  await publish({
    jsonl,
    head: readHead(bd, dirs[0]),
    baseUrl,
    token,
    dryRun,
    log: console.log,
  })
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
