import { describe, expect, it, vi } from 'vitest'
import {
  applyProbeConcurrency,
  BdQueue,
  concurrencyForProbe,
  execFileGroup,
  isReadCall,
  queueFor,
} from './bd-queue.ts'

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

  it('runs user calls before background ones, FIFO inside each lane', async () => {
    const q = new BdQueue(1)
    const log: string[] = []
    const g = gate()
    const hold = q.run(null, () => g.p)
    const job = (name: string, priority: 'user' | 'background') =>
      q.run(null, async () => void log.push(name), priority)
    const all = [
      job('bg1', 'background'),
      job('bg2', 'background'),
      job('u1', 'user'),
      job('u2', 'user'),
    ]
    g.open()
    await Promise.all([hold, ...all])
    expect(log).toEqual(['u1', 'u2', 'bg1', 'bg2'])
  })

  it('defaults to user priority and never preempts a running call', async () => {
    const q = new BdQueue(1)
    const log: string[] = []
    const g = gate()
    const running = q.run(
      null,
      async () => {
        log.push('bg-running')
        await g.p
      },
      'background',
    )
    const user = q.run(null, async () => void log.push('user'))
    await tick()
    expect(log).toEqual(['bg-running'])
    g.open()
    await Promise.all([running, user])
    expect(log).toEqual(['bg-running', 'user'])
  })

  it('moves a queued background read up when a user asks for the same one', async () => {
    const q = new BdQueue(1)
    const log: string[] = []
    const g = gate()
    const hold = q.run(null, () => g.p)
    const other = q.run(
      null,
      async () => void log.push('other-bg'),
      'background',
    )
    const poll = q.run('k', async () => (log.push('k'), 1), 'background')
    const user = q.run('k', async () => 2, 'user') // joins the poll's call
    g.open()
    expect(await Promise.all([hold, other, poll, user])).toEqual([
      undefined,
      undefined,
      1,
      1,
    ])
    expect(log).toEqual(['k', 'other-bg'])
  })

  it('raising the bound starts queued calls at once', async () => {
    const q = new BdQueue(1)
    let running = 0
    let peak = 0
    const g = gate()
    const job = () =>
      q.run(null, async () => {
        peak = Math.max(peak, ++running)
        await g.p
        running--
      })
    const all = [job(), job(), job(), job()]
    await tick()
    expect(running).toBe(1)
    q.setConcurrency(4)
    await tick()
    expect(running).toBe(4)
    g.open()
    await Promise.all(all)
    expect(peak).toBe(4)
  })

  it('picks 4 for a reachable Dolt server and 1 for embedded', () => {
    expect(concurrencyForProbe({ embedded: false, connectionOk: true })).toBe(4)
    expect(concurrencyForProbe({ embedded: true })).toBe(1)
    expect(concurrencyForProbe({ embedded: false, connectionOk: false })).toBe(
      undefined,
    )
    expect(concurrencyForProbe({ embedded: false })).toBe(undefined)
  })

  it('applies the probe to the project queue unless the env pins the limit', async () => {
    const peakFor = async (dir: string) => {
      let running = 0
      let peak = 0
      const g = gate()
      const all = [1, 2, 3, 4, 5].map(() =>
        queueFor(dir).run(null, async () => {
          peak = Math.max(peak, ++running)
          await g.p
          running--
        }),
      )
      await tick()
      g.open()
      await Promise.all(all)
      return peak
    }
    const server = { embedded: false, connectionOk: true }
    applyProbeConcurrency('/p/server', server, {})
    expect(await peakFor('/p/server')).toBe(4)
    applyProbeConcurrency('/p/pinned', server, { BD_BOARD_BD_CONCURRENCY: '2' })
    expect(await peakFor('/p/pinned')).toBe(1) // env is applied by queueFor, not the probe
    applyProbeConcurrency('/p/embedded', { embedded: true }, {})
    expect(await peakFor('/p/embedded')).toBe(1)
  })

  it('classifies read subcommands', () => {
    expect(isReadCall(['show', 'x', '--json'])).toBe(true)
    expect(isReadCall(['update', 'x'])).toBe(false)
  })
})

async function fakeBd(script: string | ((dir: string) => string)) {
  const { mkdtempSync, writeFileSync, chmodSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'bdq-'))
  const fake = join(dir, 'bd')
  const body = typeof script === 'string' ? script : script(dir)
  writeFileSync(fake, `#!/bin/sh\n${body}\n`)
  chmodSync(fake, 0o755)
  vi.stubEnv('BD_BIN', fake)
  return dir
}

describe('execFileGroup', () => {
  const run = (script: string, maxBuffer: number) =>
    execFileGroup('sh', ['-c', script], { maxBuffer, timeout: 5000 })

  it('counts maxBuffer per stream, not stdout plus stderr', async () => {
    const out = await run('head -c 80 /dev/zero; head -c 80 /dev/zero >&2', 100)
    expect([out.stdout.length, out.stderr.length]).toEqual([80, 80])
    await expect(run('head -c 150 /dev/zero >&2', 100)).rejects.toThrow(
      /maxBuffer/,
    )
  })

  it('reports a kill by signal as code null plus the signal', async () => {
    await expect(run('kill -9 $$', 100)).rejects.toMatchObject({
      code: null,
      signal: 'SIGKILL',
    })
    await expect(run('exit 3', 100)).rejects.toMatchObject({
      code: 3,
      signal: null,
    })
  })

  it('forwards SIGINT to live groups, so Ctrl-C in a dev terminal reaches bd', async () => {
    const { mkdtempSync, readFileSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { spawn } = await import('node:child_process')
    const dir = mkdtempSync(`${tmpdir()}/bdq-sig-`)
    const mod = new URL('./bd-queue.ts', import.meta.url).href
    const host = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { execFileGroup } from ${JSON.stringify(mod)}
         execFileGroup('sh', ['-c', 'echo $$ > ${dir}/pid; sleep 30'], { maxBuffer: 1e6, timeout: 60000 }).catch(() => {})`,
      ],
      { stdio: 'ignore' },
    )
    try {
      for (let i = 0; i < 200 && !existsSync(`${dir}/pid`); i++)
        await new Promise((r) => setTimeout(r, 25))
      const pid = Number(readFileSync(`${dir}/pid`, 'utf8').trim())
      const exited = new Promise<void>((r) => host.once('exit', () => r()))
      host.kill('SIGINT')
      await exited
      await new Promise((r) => setTimeout(r, 300))
      expect(() => process.kill(pid, 0)).toThrow() // the bd group is gone too
    } finally {
      host.kill('SIGKILL')
    }
  }, 10_000)
})

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

  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const pidOf = async (file: string) =>
    Number((await import('node:fs')).readFileSync(file, 'utf8').trim())

  it('leaves neither the leader nor a TERM-ignoring grandchild alive', async () => {
    const { bdExec } = await import('./bd.ts')
    const dir = await fakeBd(
      (d) =>
        `echo $$ > ${d}/leader\n(trap '' TERM; sleep 30) &\necho $! > ${d}/gc\nwait`,
    )
    vi.stubEnv('BD_BOARD_BD_TIMEOUT_MS', '2000') // a fresh script can take a while to first start
    const started = Date.now()
    try {
      await expect(bdExec(dir, ['show', 'x'])).rejects.toThrow(/timed out/)
      expect(Date.now() - started).toBeLessThan(2800) // rejects at the timeout, not after the pipes close
      const [leader, gc] = [
        await pidOf(`${dir}/leader`),
        await pidOf(`${dir}/gc`),
      ]
      await new Promise((r) => setTimeout(r, 3000)) // past the SIGKILL grace
      expect(alive(leader)).toBe(false)
      expect(alive(gc)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  }, 10_000)

  it('leaves no pipeline member alive (shape of the read-only shim)', async () => {
    const { bdExec } = await import('./bd.ts')
    const dir = await fakeBd(
      (d) =>
        `echo $$ > ${d}/leader\nsleep 30 | python3 -c "import os,time;open('${d}/py','w').write(str(os.getpid()));time.sleep(30)"`,
    )
    vi.stubEnv('BD_BOARD_BD_TIMEOUT_MS', '2000')
    try {
      await expect(bdExec(dir, ['list'])).rejects.toThrow(/timed out/)
      const [leader, py] = [
        await pidOf(`${dir}/leader`),
        await pidOf(`${dir}/py`),
      ]
      await new Promise((r) => setTimeout(r, 3000))
      expect(alive(leader)).toBe(false)
      expect(alive(py)).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  }, 10_000)

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

  it('reports a bd killed by a signal as that, not as exit 1', async () => {
    const { bdExec } = await import('./bd.ts')
    const dir = await fakeBd('kill -9 $$')
    try {
      await expect(bdExec(dir, ['show', 'x'])).rejects.toThrow(
        /killed by SIGKILL/,
      )
      await expect(bdExec(dir, ['update', 'x'])).rejects.toThrow(
        /killed by SIGKILL.*may have been applied/,
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
