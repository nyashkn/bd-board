/**
 * Per-project bd call queue. Embedded Dolt holds a process lock, so parallel `bd` calls
 * against one project serialize badly (8 parallel `show` = 4.3 s vs ~0.4 s each alone).
 * Calls for a project run through a bounded queue (default 1); a read with the same key
 * that is already queued or running shares that call's result (single-flight).
 */

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
  private inflight = new Map<string, Promise<unknown>>()

  private readonly concurrency: number

  constructor(concurrency = DEFAULT_CONCURRENCY) {
    this.concurrency = concurrency
  }

  /** Run `fn` once a slot is free. A non-null `key` joins an identical pending call. */
  run<T>(key: string | null, fn: () => Promise<T>): Promise<T> {
    if (key !== null) {
      const pending = this.inflight.get(key)
      if (pending) return pending as Promise<T>
    }
    const p = this.acquire().then(async () => {
      try {
        return await fn()
      } finally {
        this.release()
      }
    })
    if (key !== null) {
      this.inflight.set(key, p)
      const clear = () => {
        if (this.inflight.get(key) === p) this.inflight.delete(key)
      }
      p.then(clear, clear)
    }
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
