/**
 * Per-project bd call queue. Embedded Dolt holds a process lock, so parallel `bd` calls
 * against one project serialize badly (8 parallel `show` = 4.3 s vs ~0.4 s each alone).
 * Calls for a project run through a bounded queue (default 1); a read with the same key
 * that is still queued shares that call's result (single-flight).
 */

import { execFile } from 'node:child_process'
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'

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
  return READ_COMMANDS.has(args[0] ?? '')
}

export class BdQueue {
  private active = 0
  private waiting: (() => void)[] = []
  private waitingReads = new Map<string, Promise<unknown>>()

  private readonly concurrency: number

  constructor(concurrency = DEFAULT_CONCURRENCY) {
    this.concurrency = concurrency
  }

  /**
   * Run `fn` once a slot is free, in arrival order. A non-null `key` joins an identical
   * read that is still waiting for its turn; a read that already started is never shared,
   * because a write may have finished since it began.
   */
  run<T>(key: string | null, fn: () => Promise<T>): Promise<T> {
    if (key !== null) {
      const pending = this.waitingReads.get(key)
      if (pending) return pending as Promise<T>
    }
    const p: Promise<T> = this.acquire().then(async () => {
      if (key !== null && this.waitingReads.get(key) === p)
        this.waitingReads.delete(key)
      try {
        return await fn()
      } finally {
        this.release()
      }
    })
    if (key !== null) this.waitingReads.set(key, p)
    return p
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  private release(): void {
    const next = this.waiting.shift()
    if (next)
      next() // hand the slot over; active stays the same
    else this.active--
  }
}

const queues = new Map<string, BdQueue>()

export function concurrencyFromEnv(env: NodeJS.ProcessEnv): number {
  const n = Number(env['BD_BOARD_BD_CONCURRENCY'])
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_CONCURRENCY
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

/** Queue a bd call for `dir`; reads coalesce on dir + args. */
export function queued<T>(
  dir: string,
  args: readonly string[],
  fn: () => Promise<T>,
): Promise<T> {
  const key = isReadCall(args) ? JSON.stringify([dir, args]) : null
  return queueFor(dir).run(key, fn)
}

/** Time between SIGTERM and SIGKILL when a call times out. */
export const KILL_GRACE_MS = 2000

function signalGroup(
  child: { pid?: number; kill: (s: NodeJS.Signals) => boolean },
  sig: NodeJS.Signals,
): void {
  try {
    // The child leads its own process group (detached), so this also reaches what the
    // read-only shim spawns, which would otherwise keep the pipes and the Dolt lock.
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, sig)
    else child.kill(sig)
  } catch {
    // already gone
  }
}

export class BdTimeoutError extends Error {
  readonly timedOut = true
}

/**
 * execFile with a timeout that stops the whole process group (SIGTERM, SIGKILL after a
 * grace) and rejects at once instead of waiting for pipes a survivor may hold open.
 */
export function execFileGroup(
  file: string,
  args: string[],
  opts: Omit<ExecFileOptionsWithStringEncoding, 'encoding' | 'timeout'> & {
    timeout: number
  },
): Promise<{ stdout: string; stderr: string }> {
  const { timeout, ...rest } = opts
  const options = {
    ...rest,
    detached: process.platform !== 'win32',
    encoding: 'utf8' as const,
  }
  return new Promise((resolve, reject) => {
    let timedOut = false
    const child = execFile(file, args, options, (err, stdout, stderr) => {
      clearTimeout(timer)
      if (timedOut) return
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
    const timer = setTimeout(() => {
      timedOut = true
      signalGroup(child, 'SIGTERM')
      setTimeout(() => signalGroup(child, 'SIGKILL'), KILL_GRACE_MS).unref()
      reject(new BdTimeoutError('timed out'))
    }, timeout)
  })
}
