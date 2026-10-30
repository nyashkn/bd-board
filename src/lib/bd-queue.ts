/**
 * Per-project bd call queue. Embedded Dolt holds a process lock, so parallel `bd` calls
 * against one project serialize badly (8 parallel `show` = 4.3 s vs ~0.4 s each alone).
 * Calls for a project run through a bounded queue (default 1); a read with the same key
 * that is still queued shares that call's result (single-flight).
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

export class BdTimeoutError extends Error {
  readonly timedOut = true
}

export class BdBufferError extends Error {
  readonly code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
}

type Child = ReturnType<typeof spawn>

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
 * non-zero exit carry numeric `code`, `stdout` and `stderr`, like execFile's.
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
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.destroy()
      child.stderr.destroy()
      fn()
    }
    const text = () => ({
      stdout: Buffer.concat(out).toString('utf8'),
      stderr: Buffer.concat(err).toString('utf8'),
    })
    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length
      if (size > opts.maxBuffer) {
        stopGroup(child)
        finish(() => reject(new BdBufferError('maxBuffer exceeded')))
        return
      }
      into.push(chunk)
    }
    child.stdout.on('data', collect(out))
    child.stderr.on('data', collect(err))
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    child.on('error', (e) => finish(() => reject(e)))
    child.on('close', (code) =>
      finish(() => {
        if (code === 0) resolve(text())
        else
          reject(
            Object.assign(new Error(`exit ${code}`), {
              code: code ?? 1,
              ...text(),
            }),
          )
      }),
    )
    const timer = setTimeout(() => {
      stopGroup(child)
      finish(() => reject(new BdTimeoutError('timed out')))
    }, opts.timeout)
  })
}
