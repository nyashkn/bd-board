/**
 * Per-project bd call queue. Embedded Dolt holds a process lock, so parallel `bd` calls
 * against one project serialize badly (8 parallel `show` = 4.3 s vs ~0.4 s each alone).
 * Calls for a project run through a bounded queue (default 1, 4 once the probe says the
 * project is on a reachable Dolt server); writes also pass a limit-1 FIFO queue in front of
 * it, so they land in arrival order whatever the bound; a read with the same key that is still queued
 * shares that call's result (single-flight). Two FIFO lanes: user-initiated calls go before
 * background polls; a running call is never preempted.
 */

import { spawn } from 'node:child_process'

export const DEFAULT_CONCURRENCY = 1
export const DEFAULT_TIMEOUT_MS = 60_000

/** bd subcommands that only read, so identical in-flight calls can share one process. */
const READ_COMMANDS = new Set([
  'list',
  'show',
  'comments',
  'blocked',
  'ready',
  'count',
  'export',
  'where',
])

export function isReadCall(args: readonly string[]): boolean {
  // `dolt show` is the probe; other `dolt` subcommands (push, commit, ...) write.
  if (args[0] === 'dolt') return args[1] === 'show'
  return READ_COMMANDS.has(args[0] ?? '')
}

/** 'user' = a bead open or a write; 'background' = an interval poll or the probe. */
export type Priority = 'user' | 'background'

type Waiter = { go: () => void; lane: Priority }

export class BdQueue {
  private active = 0
  private waiting: Record<Priority, Waiter[]> = { user: [], background: [] }
  private waitingReads = new Map<
    string,
    { p: Promise<unknown>; waiter: Waiter | null }
  >()

  private concurrency: number

  constructor(concurrency = DEFAULT_CONCURRENCY) {
    this.concurrency = concurrency
  }

  /**
   * Run `fn` once a slot is free: user calls first, then background, each in arrival order.
   * A non-null `key` joins an identical read that is still waiting for its turn (a user
   * joiner moves a background read up to the user lane); a read that already started is
   * never shared, because a write may have finished since it began.
   */
  run<T>(
    key: string | null,
    fn: () => Promise<T>,
    priority: Priority = 'user',
  ): Promise<T> {
    if (key !== null) {
      const pending = this.waitingReads.get(key)
      if (pending) {
        if (priority === 'user') this.promote(pending.waiter)
        return pending.p as Promise<T>
      }
    }
    const { ready, waiter } = this.acquire(priority)
    const p: Promise<T> = ready.then(async () => {
      if (key !== null && this.waitingReads.get(key)?.p === p)
        this.waitingReads.delete(key)
      try {
        return await fn()
      } finally {
        this.release()
      }
    })
    if (key !== null) this.waitingReads.set(key, { p, waiter })
    return p
  }

  /** Change the bound at runtime (e.g. once the probe shows a Dolt server). Never preempts. */
  setConcurrency(n: number): void {
    this.concurrency = n
    while (this.active < this.concurrency) {
      const next = this.nextWaiter()
      if (!next) return
      this.active++
      next.go()
    }
  }

  private promote(waiter: Waiter | null): void {
    if (!waiter || waiter.lane === 'user') return
    const i = this.waiting.background.indexOf(waiter)
    if (i < 0) return
    this.waiting.background.splice(i, 1)
    waiter.lane = 'user'
    this.waiting.user.push(waiter)
  }

  private nextWaiter(): Waiter | undefined {
    return this.waiting.user.shift() ?? this.waiting.background.shift()
  }

  private acquire(priority: Priority): {
    ready: Promise<void>
    waiter: Waiter | null
  } {
    if (this.active < this.concurrency) {
      this.active++
      return { ready: Promise.resolve(), waiter: null }
    }
    let waiter!: Waiter
    const ready = new Promise<void>((go) => {
      waiter = { go, lane: priority }
    })
    this.waiting[priority].push(waiter)
    return { ready, waiter }
  }

  private release(): void {
    const next = this.active > this.concurrency ? undefined : this.nextWaiter()
    if (next)
      next.go() // hand the slot over; active stays the same
    else this.active--
  }
}

const queues = new Map<string, BdQueue>()

/** Concurrency for projects on a reachable Dolt server; embedded Dolt stays at 1. */
export const SERVER_CONCURRENCY = 4

/** The explicit BD_BOARD_BD_CONCURRENCY, if valid; it beats the probe-based default. */
function envConcurrency(env: NodeJS.ProcessEnv): number | undefined {
  const n = Number(env['BD_BOARD_BD_CONCURRENCY'])
  return Number.isInteger(n) && n >= 1 ? n : undefined
}

export function concurrencyFromEnv(env: NodeJS.ProcessEnv): number {
  return envConcurrency(env) ?? DEFAULT_CONCURRENCY
}

/** What the probe says about a project's limit: reachable server = 4, embedded or unreachable server = 1, else unknown. */
export function concurrencyForProbe(p: {
  embedded?: boolean
  connectionOk?: boolean
}): number | undefined {
  if (p.embedded === true || p.connectionOk === false)
    return DEFAULT_CONCURRENCY
  if (p.embedded === false && p.connectionOk === true) return SERVER_CONCURRENCY
  return undefined
}

/** Apply a probe result to `dir`'s queue, unless the env pins the limit. */
export function applyProbeConcurrency(
  dir: string,
  probe: { embedded?: boolean; connectionOk?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): void {
  const n = concurrencyForProbe(probe)
  if (n !== undefined && envConcurrency(env) === undefined)
    queueFor(dir).setConcurrency(n)
}

export function timeoutFromEnv(env: NodeJS.ProcessEnv): number {
  const n = Number(env['BD_BOARD_BD_TIMEOUT_MS'])
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS
}

export function queueFor(dir: string): BdQueue {
  let q = queues.get(dir)
  if (!q) {
    q = new BdQueue(concurrencyFromEnv(process.env))
    queues.set(dir, q)
  }
  return q
}

const writeQueues = new Map<string, BdQueue>()

/** Writes to one project go through this limit-1 queue, so they stay in arrival order. */
function writeQueueFor(dir: string): BdQueue {
  let q = writeQueues.get(dir)
  if (!q) {
    q = new BdQueue(1)
    writeQueues.set(dir, q)
  }
  return q
}

/** Queue a bd call for `dir`; reads coalesce on dir + args, writes run one at a time in order. */
export function queued<T>(
  dir: string,
  args: readonly string[],
  fn: () => Promise<T>,
  priority: Priority = 'user',
): Promise<T> {
  if (!isReadCall(args))
    return writeQueueFor(dir).run(
      null,
      () => queueFor(dir).run(null, fn, priority),
      priority,
    )
  return queueFor(dir).run(JSON.stringify([dir, args]), fn, priority)
}

/** Time between SIGTERM and SIGKILL when a call times out. */
export const KILL_GRACE_MS = 2000

export class BdTimeoutError extends Error {
  readonly timedOut = true
}

export class BdBufferError extends Error {
  readonly code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
}

type Child = ReturnType<typeof spawn>

// On globalThis so a hot-reloaded copy of this module shares the set and does not stack listeners.
const shared = globalThis as {
  __bdLiveGroups?: Set<number>
  __bdSignalsHooked?: boolean
}

/** Process groups of the bd calls that are running now. */
const liveGroups = (shared.__bdLiveGroups ??= new Set<number>())

/**
 * bd children lead their own process group, so a Ctrl-C or hangup aimed at this process
 * (the dev server) no longer reaches them. On SIGINT/SIGTERM/SIGHUP, SIGTERM every live
 * group. If no one else listens for that signal, hand it back so the process still exits;
 * otherwise leave the exit to the other handler (Vite's shutdown is async and must finish).
 * A SIGKILL of this process cannot be forwarded; bd's pipes close, which ends most calls.
 */
function hookSignals(): void {
  if (shared.__bdSignalsHooked || process.platform === 'win32') return
  shared.__bdSignalsHooked = true
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    const owned = process.listenerCount(sig) === 0
    const onSignal = () => {
      stopLiveGroups()
      process.removeListener(sig, onSignal)
      if (owned && process.listenerCount(sig) === 0)
        process.kill(process.pid, sig)
    }
    process.on(sig, onSignal)
  }
}

export function stopLiveGroups(): void {
  for (const pgid of liveGroups) {
    try {
      process.kill(-pgid, 'SIGTERM')
    } catch {
      // already gone
    }
  }
}

const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * SIGTERM the child's process group (it leads its own, via detached), which also reaches
 * what the read-only shim spawns and would otherwise keep the pipes and the Dolt lock; then
 * SIGKILL whatever is left once the group is gone or the grace is up. Windows has no
 * process groups here: only the direct child is killed.
 */
function stopGroup(child: Child): void {
  const pid = child.pid
  if (!pid) return
  if (process.platform === 'win32') {
    child.kill()
    return
  }
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig)
    } catch {
      // already gone
    }
  }
  signal('SIGTERM')
  const until = Date.now() + KILL_GRACE_MS
  const poll = setInterval(() => {
    if (!groupAlive(pid) || Date.now() >= until) {
      clearInterval(poll)
      signal('SIGKILL')
    }
  }, 20)
  poll.unref()
}

/**
 * Run a command, collecting its output, with a timeout that stops the whole process group
 * and rejects at once instead of waiting for pipes a survivor may hold open. Errors from a
 * non-zero exit carry numeric `code`, `stdout` and `stderr`, like execFile's; a kill by signal
 * carries `code: null` and `signal`.
 */
export function execFileGroup(
  file: string,
  args: string[],
  opts: {
    cwd?: string
    env?: NodeJS.ProcessEnv
    maxBuffer: number
    timeout: number
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    hookSignals()
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (child.pid) liveGroups.add(child.pid)
    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.pid) liveGroups.delete(child.pid)
      child.stdout.destroy()
      child.stderr.destroy()
      fn()
    }
    const text = () => ({
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    })
    // maxBuffer applies to each stream on its own, as in execFile.
    const collect = (into: Buffer[]) => {
      let size = 0
      return (chunk: Buffer) => {
        size += chunk.length
        if (size > opts.maxBuffer) {
          stopGroup(child)
          finish(() => reject(new BdBufferError('maxBuffer exceeded')))
          return
        }
        into.push(chunk)
      }
    }
    child.stdout.on('data', collect(out))
    child.stderr.on('data', collect(err))
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code, signal) =>
      finish(() => {
        if (code === 0) resolve(text())
        else
          reject(
            // Killed by a signal: `code` is null and `signal` says which, never a fake exit 1.
            Object.assign(
              new Error(signal ? `killed by ${signal}` : `exit ${code}`),
              {
                code,
                signal,
                ...text(),
              },
            ),
          )
      }),
    )
    const timer = setTimeout(() => {
      stopGroup(child)
      finish(() => reject(new BdTimeoutError('timed out')))
    }, opts.timeout)
  })
}
