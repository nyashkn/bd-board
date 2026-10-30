import { describe, expect, it, vi } from 'vitest'
import { BdQueue, isReadCall } from './bd-queue.ts'

const gate = () => {
  let open!: () => void
  const p = new Promise<void>((r) => (open = r))
  return { p, open }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('BdQueue', () => {
  it('runs one at a time in arrival order at concurrency 1', async () => {
    const q = new BdQueue(1)
    const log: string[] = []
    const g = gate()
    const a = q.run(null, async () => {
      log.push('a+')
      await g.p
      log.push('a-')
    })
    const b = q.run(null, async () => {
      log.push('b+')
    })
    await tick()
    expect(log).toEqual(['a+'])
    g.open()
    await Promise.all([a, b])
    expect(log).toEqual(['a+', 'a-', 'b+'])
  })

  it('honours a higher concurrency bound', async () => {
    const q = new BdQueue(2)
    let running = 0
    let peak = 0
    const g = gate()
    const job = () =>
      q.run(null, async () => {
        peak = Math.max(peak, ++running)
        await g.p
        running--
      })
    const all = [job(), job(), job()]
    await tick()
    expect(running).toBe(2)
    g.open()
    await Promise.all(all)
    expect(peak).toBe(2)
  })

  it('shares one call between identical keyed reads that are still queued', async () => {
    const q = new BdQueue(1)
    let calls = 0
    const g = gate()
    const fn = async () => ++calls
    const hold = q.run(null, () => g.p)
    const x = q.run('k', fn)
    const y = q.run('k', fn)
    g.open()
    await hold
    expect(await Promise.all([x, y])).toEqual([1, 1])
    expect(await q.run('k', fn)).toBe(2) // finished calls are not cached
  })

  it('does not hand a read that started before a write to a read issued after it', async () => {
    const q = new BdQueue(2)
    const g = gate()
    const early = q.run('k', async () => {
      await g.p
      return 'before-write'
    })
    await tick() // the early read is running
    await q.run(null, async () => 'write')
    const late = q.run('k', async () => 'after-write')
    g.open()
    expect(await late).toBe('after-write')
    expect(await early).toBe('before-write')
  })

  it('never coalesces null keys', async () => {
    const q = new BdQueue(1)
    let calls = 0
    await Promise.all([
      q.run(null, async () => ++calls),
      q.run(null, async () => ++calls),
    ])
    expect(calls).toBe(2)
  })

  it('propagates errors to every joiner and keeps draining', async () => {
    const q = new BdQueue(1)
    const boom = () => q.run('k', () => Promise.reject(new Error('boom')))
    const results = await Promise.allSettled([boom(), boom()])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(await q.run(null, async () => 'ok')).toBe('ok')
  })

  it('classifies read subcommands', () => {
    expect(isReadCall(['show', 'x', '--json'])).toBe(true)
    expect(isReadCall(['update', 'x'])).toBe(false)
  })
})

async function fakeBd(script: string) {
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'bdq-'))
  const fake = join(dir, 'bd')
  writeFileSync(fake, `#!/bin/sh\n${script}\n`)
  chmodSync(fake, 0o755)
  vi.stubEnv('BD_BIN', fake)
  return dir
}

describe('bdExec timeout', () => {
  it('stops a hung bd and says so', async () => {
    const { bdExec } = await import('./bd.ts')
    const dir = await fakeBd('sleep 5')
    vi.stubEnv('BD_BOARD_BD_TIMEOUT_MS', '150')
    try {
      await expect(bdExec(dir, ['show', 'x'])).rejects.toThrow(/timed out/)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('frees the call when a grandchild keeps the pipe open (read-only shim pipeline)', async () => {
    const { bdExec } = await import('./bd.ts')
    const dir = await fakeBd("(trap '' TERM; sleep 30) &\nwait")
    vi.stubEnv('BD_BOARD_BD_TIMEOUT_MS', '150')
    const started = Date.now()
    try {
      await expect(bdExec(dir, ['show', 'x'])).rejects.toThrow(/timed out/)
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('tells the user a timed-out write may have been applied', async () => {
    const { bdExec } = await import('./bd.ts')
    const dir = await fakeBd('sleep 5')
    vi.stubEnv('BD_BOARD_BD_TIMEOUT_MS', '150')
    try {
      await expect(bdExec(dir, ['update', 'x'])).rejects.toThrow(
        /may have been applied/,
      )
      await expect(bdExec(dir, ['show', 'x'])).rejects.not.toThrow(
        /may have been applied/,
      )
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('reports output over the buffer as that, not as a timeout', async () => {
    const { bdExec } = await import('./bd.ts')
    const dir = await fakeBd('head -c 70000000 /dev/zero')
    try {
      await expect(bdExec(dir, ['list'])).rejects.toThrow(/output.*buffer/i)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
