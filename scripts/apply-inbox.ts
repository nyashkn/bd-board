// Apply the snapshot Worker's write-back inbox to a local bd project (run on the owner's machine).
//
//   SNAPSHOT_URL=https://snapshots.example.com SNAPSHOT_WRITE_TOKEN=... \
//     node --experimental-strip-types --no-warnings scripts/apply-inbox.ts [--dry-run] <project-dir>
//
// marker (ETag/304) -> list -> for each item: validate -> `bd comments add` -> record client_id -> ack.
// Delivery is at-least-once; the local record makes the effect exactly-once, including across a crash:
//   - the comment body ends with `(via inbox, <client_id>)`, and `state.pending` is saved BEFORE bd runs;
//   - if the process dies anywhere after that, the next run reads the bead's comments, and a comment
//     carrying the client_id counts as applied (so the item is only acked), otherwise it is retried;
//   - the id is recorded before the ack, so a crash between them only repeats the ack.
// One run at a time: a lock file (pid, stale locks are taken over) refuses a second concurrent run.
import { execFile } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { UUID, parseInboxItem } from '../workers/snapshot/src/inbox.ts'
import type { InboxItem } from '../workers/snapshot/src/inbox.ts'
import { endpoint } from './publish-snapshot.ts'

export interface ApplyState {
  /** client_ids already applied to bd (kept after the ack: a viewer retry can re-queue an acked id). */
  applied: string[]
  /** Marker ETag seen by the last fully clean run. */
  marker: string | null
  /** The item bd was last started on. Cleared once its outcome is known. */
  pending: { id: string; bead: string } | null
  /** Failed bd attempts per client_id; an item that keeps failing is dead-lettered. */
  attempts: Record<string, number>
}

/** Runs `bd <args>` in the project directory and returns stdout; rejects when bd fails. */
export type RunBd = (args: string[]) => Promise<string>

export interface ApplyInput {
  baseUrl: string
  token: string
  statePath: string
  runBd: RunBd
  dryRun?: boolean
  fetch?: typeof fetch
  log?: (line: string) => void
}

export interface ApplyResult {
  applied: number
  acked: number
  /** Items moved to inbox-dead/ on the Worker: invalid, or bd rejected them MAX_ATTEMPTS times. */
  dead: number
  /** Items left in the inbox to retry: bd failed, or the ack failed. */
  failed: number
  skipped: 'marker-unchanged' | 'no-inbox' | null
}

const MAX_APPLIED_IDS = 10_000
const MAX_ROUNDS = 20
const MAX_ATTEMPTS = 3

export function loadState(path: string): ApplyState {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return { applied: [], marker: null, pending: null, attempts: {} }
    throw err
  }
  // A corrupt record must stop the run: starting empty would apply old items again.
  const s = JSON.parse(text) as Partial<ApplyState>
  if (!Array.isArray(s.applied)) throw new Error(`bad state file ${path}`)
  return {
    applied: s.applied,
    marker: s.marker ?? null,
    pending: s.pending ?? null,
    attempts: s.attempts ?? {},
  }
}

function saveState(path: string, state: ApplyState) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(
    tmp,
    JSON.stringify({
      ...state,
      applied: state.applied.slice(-MAX_APPLIED_IDS),
    }),
  )
  renameSync(tmp, path) // atomic: a crash leaves the old or the new file, never half of one
}

/** Take the run lock, or throw. A lock whose pid is gone is stale: remove it and try once more. */
function acquireLock(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let alive = true
      try {
        process.kill(Number(readFileSync(path, 'utf8')), 0)
      } catch (k) {
        // Only ESRCH proves the owner is gone; an unreadable pid or EPERM counts as alive.
        alive = (k as NodeJS.ErrnoException).code !== 'ESRCH'
      }
      if (alive || attempt > 0)
        throw new Error(`another run in progress (lock ${path})`)
      unlinkSync(path)
    }
  }
}

const footer = (id: string) => `\n\n(via inbox, ${id})`

/**
 * The exact argv for bd. Never a shell; `--` keeps a body that starts with `-` from being read as a flag.
 * The author is a label from an untrusted viewer, so it is suffixed and can't pose as a real actor.
 */
export const bdArgs = (i: InboxItem) => [
  'comments',
  'add',
  `--author=${i.author} (inbox)`,
  '--',
  i.bead,
  i.body + footer(i.client_id),
]

// Untrusted text in a terminal log: escape control characters, truncate.
const show = (s: string) =>
  JSON.stringify(s.slice(0, 80)).replace(
    /\p{C}/gu,
    (c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, '0')}`,
  )

async function failure(what: string, res: Response) {
  const body = (await res.text().catch(() => '')).slice(0, 200)
  return new Error(`${what} failed: HTTP ${res.status} ${body}`.trim())
}

export async function applyInbox(input: ApplyInput): Promise<ApplyResult> {
  const doFetch = input.fetch ?? fetch
  const log = input.log ?? (() => {})
  const url = endpoint(input.baseUrl)
  const auth = { authorization: `Bearer ${input.token}` }
  const lockPath = `${input.statePath}.lock`
  if (!input.dryRun) acquireLock(lockPath)
  try {
    return await run()
  } finally {
    if (!input.dryRun) unlinkSync(lockPath)
  }

  async function run(): Promise<ApplyResult> {
    const send = (path: string, init: RequestInit = {}) =>
      doFetch(url(path), {
        ...init,
        redirect: 'error',
        headers: { ...auth, ...(init.headers as Record<string, string>) },
      })
    const state = loadState(input.statePath)
    const save = () => saveState(input.statePath, state)
    const result: ApplyResult = {
      applied: 0,
      acked: 0,
      dead: 0,
      failed: 0,
      skipped: null,
    }

    // Did bd write the pending item although we never saw it finish (a crash or a timeout)?
    // If the read itself fails this throws, which stops the run with the pending item still saved.
    async function reconcilePending() {
      const p = state.pending
      if (!p) return false
      const out = await input.runBd(['comments', p.bead, '--json'])
      const found = out.includes(`(via inbox, ${p.id})`)
      if (found) state.applied.push(p.id)
      state.pending = null
      save()
      if (found) log(`found ${p.id} already in ${p.bead}; not applying again`)
      return found
    }
    if (!input.dryRun) await reconcilePending()

    // Class B read first: list (Class A) only when a POST happened since the last clean run.
    const m = await send('inbox/_marker', {
      headers: state.marker ? { 'if-none-match': state.marker } : {},
    })
    if (m.status === 304) return { ...result, skipped: 'marker-unchanged' }
    if (m.status === 404) return { ...result, skipped: 'no-inbox' }
    if (m.status !== 200) throw await failure('GET marker', m)
    // Read before listing: a POST that lands during the run moves the marker, so the next run lists again.
    const marker = m.headers.get('etag')

    // Ack, or with `dead` move the item to inbox-dead/ on the Worker. True when the Worker took it.
    async function drop(id: string, dead: boolean) {
      const res = await send(`inbox/${id}${dead ? '?dead=1' : ''}`, {
        method: 'DELETE',
      })
      if (!res.ok) log(`ack failed for ${id}: HTTP ${res.status}`)
      return res.ok
    }

    let more = false
    let cursor: string | null = null
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await send(
        `inbox${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      )
      if (!res.ok) throw await failure('GET inbox', res)
      const body = (await res.json()) as {
        items: unknown[]
        more: boolean
        cursor: string | null
      }
      more = body.more
      cursor = body.cursor

      const queued: { item: InboxItem; received: string }[] = []
      for (const raw of body.items) {
        // received_at is the Worker's own stamp; everything else must pass the same check as a POST.
        const { received_at: at, ...fields } = (raw ?? {}) as Record<
          string,
          unknown
        >
        const item = parseInboxItem(fields)
        if (typeof item !== 'string') {
          queued.push({ item, received: typeof at === 'string' ? at : '' })
          continue
        }
        // Never passed to bd. Moved aside so one bad item cannot sit in the queue for ever.
        const id = fields['client_id']
        log(`invalid item: ${show(item)}`)
        if (input.dryRun) continue
        if (typeof id === 'string' && UUID.test(id)) {
          if (await drop(id.toLowerCase(), true)) result.dead++
          else result.failed++
        } else result.failed++ // no usable id to address it
      }
      // Oldest first, so comments land in the order they were written.
      const items = queued
        .sort((a, b) => a.received.localeCompare(b.received))
        .map((q) => q.item)

      for (const item of items) {
        const id = item.client_id
        if (input.dryRun) {
          log(`dry run: would run bd ${bdArgs(item).map(show).join(' ')}`)
          continue
        }
        let applied = state.applied.includes(id)
        if (applied) log(`already applied ${id}; acknowledging only`)
        else {
          // Saved before bd runs: if we die from here on, the next run looks for the footer in bd.
          state.pending = { id, bead: item.bead }
          save()
          let error: unknown
          try {
            await input.runBd(bdArgs(item))
            state.applied.push(id)
            state.pending = null
            delete state.attempts[id]
            save()
            applied = true
            result.applied++
            log(`applied ${id} to ${item.bead}`)
          } catch (err) {
            error = err
          }
          if (error !== undefined) {
            // bd may have written before it failed (a timeout); look before deciding it did not.
            if (await reconcilePending()) {
              applied = true
              result.applied++
            } else {
              const n = (state.attempts[id] ?? 0) + 1
              state.attempts[id] = n
              save()
              log(
                `bd failed for ${id} (${item.bead}), attempt ${n}: ${show(error instanceof Error ? error.message : String(error))}`,
              )
              if (n >= MAX_ATTEMPTS) {
                // bd keeps rejecting it (for example the bead does not exist): stop retrying.
                if (await drop(id, true)) {
                  result.dead++
                  delete state.attempts[id]
                  save()
                } else result.failed++
              } else result.failed++
              continue
            }
          }
        }
        if (applied) {
          if (await drop(id, false)) result.acked++
          else result.failed++
        }
      }
      if (input.dryRun || !more) break
    }

    // Remember the marker only after a clean, complete drain; otherwise the next run must list again.
    if (!input.dryRun && result.failed === 0 && !more && marker) {
      state.marker = marker
      save()
    }
    return result
  }
}

const execFileAsync = promisify(execFile)

/** bd runner for a project dir. The write token is removed from bd's environment. */
export function bdRunner(bd: string, cwd: string): RunBd {
  const env = { ...process.env }
  delete env['SNAPSHOT_WRITE_TOKEN']
  return async (args) => {
    try {
      const { stdout } = await execFileAsync(bd, args, {
        cwd,
        env,
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      })
      return stdout
    } catch (err) {
      const e = err as { stderr?: string; message: string }
      throw new Error((e.stderr?.trim() || e.message).slice(0, 300))
    }
  }
}

async function main(argv: string[]) {
  const dryRun = argv.includes('--dry-run')
  const dirs = argv.filter((a) => !a.startsWith('--'))
  const baseUrl = process.env['SNAPSHOT_URL']
  const token = process.env['SNAPSHOT_WRITE_TOKEN']
  if (dirs.length !== 1 || !baseUrl || !token) {
    throw new Error(
      'usage: SNAPSHOT_URL=... SNAPSHOT_WRITE_TOKEN=... apply-inbox.ts [--dry-run] <project-dir>',
    )
  }
  const result = await applyInbox({
    baseUrl,
    token,
    dryRun,
    // .beads/ is gitignored, so the record never reaches the repository.
    statePath: join(dirs[0], '.beads', 'inbox-applied.json'),
    runBd: bdRunner(process.env['BD_BIN'] || 'bd', dirs[0]),
    log: console.log,
  })
  console.log(JSON.stringify(result))
  if (result.failed > 0) process.exitCode = 1
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
