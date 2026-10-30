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

  it('shares one call between identical keyed reads', async () => {
    const q = new BdQueue(1)
    let calls = 0
    const g = gate()
    const fn = async () => {
      calls++
      await g.p
      return calls
    }
    const x = q.run('k', fn)
    const y = q.run('k', fn)
    g.open()
    expect(await Promise.all([x, y])).toEqual([1, 1])
    expect(await q.run('k', fn)).toBe(2) // finished calls are not cached
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

describe('bdExec timeout', () => {
  it('stops a hung bd and says so', async () => {
    const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { bdExec } = await import('./bd.ts')
    const dir = mkdtempSync(join(tmpdir(), 'bdq-'))
    const fake = join(dir, 'bd')
    writeFileSync(fake, '#!/bin/sh\nsleep 5\n')
    chmodSync(fake, 0o755)
    vi.stubEnv('BD_BIN', fake)
    vi.stubEnv('BD_BOARD_BD_TIMEOUT_MS', '150')
    try {
      await expect(bdExec(dir, ['show', 'x'])).rejects.toThrow(/timed out/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
