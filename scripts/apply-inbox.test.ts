import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyInbox, bdArgs, bdRunner } from './apply-inbox.ts'
import type { RunBd } from './apply-inbox.ts'

const TOKEN = 'write-token-placeholder'
const BASE = 'https://snapshots.example.com'
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n: number, over: Record<string, unknown> = {}) => ({
  op: 'comment.add',
  bead: 'demo-1',
  body: `comment ${n}`,
  author: 'Ada',
  client_id: id(n),
  received_at: `2026-01-01T00:00:0${n}.000Z`,
  ...over,
})
// What bd receives for item n: the body plus the idempotency footer.
const sent = (n: number, bead = 'demo-1') => [
  'comments',
  'add',
  '--author=Ada (inbox)',
  '--',
  bead,
  `comment ${n}\n\n(via inbox, ${id(n)})`,
]

/** In-memory stand-in for the Worker's inbox routes. */
function fakeWorker(initial: object[] = [], pageSize = 100) {
  const items = new Map<string, object>(
    initial.map((i) => [(i as { client_id: string }).client_id, i]),
  )
  const dead = new Map<string, object>()
  let marker = 1
  const calls: string[] = []
  const failAck = new Set<string>()
  const w = {
    fetch: (async (input: string, init: RequestInit = {}) => {
      const u = new URL(input)
      const method = init.method ?? 'GET'
      calls.push(`${method} ${u.pathname}`)
      const headers = init.headers as Record<string, string>
      expect(headers['authorization']).toBe(`Bearer ${TOKEN}`)
      expect(init.redirect).toBe('error')
      if (u.pathname === '/inbox/_marker') {
        const etag = `"m${marker}"`
        return headers['if-none-match'] === etag
          ? new Response(null, { status: 304 })
          : new Response('{}', { headers: { etag } })
      }
      if (u.pathname === '/inbox') {
        // Like R2: key-ordered, and the cursor is a position in key space, so acks don't shift it.
        const after = u.searchParams.get('cursor') ?? ''
        const rest = [...items.keys()].sort().filter((k) => k > after)
        const page = rest.slice(0, pageSize)
        const more = rest.length > pageSize
        return Response.json({
          items: page.map((k) => items.get(k)),
          more,
          cursor: more ? page[page.length - 1] : null,
        })
      }
      const m = /^\/inbox\/(.+)$/.exec(u.pathname)
      if (m && method === 'DELETE') {
        const key = m[1]
        if (failAck.has(key)) return new Response('boom', { status: 500 })
        if (u.searchParams.get('dead') === '1' && items.has(key))
          dead.set(key, items.get(key)!)
        items.delete(key)
        return new Response(null, { status: 204 })
      }
      return new Response('?', { status: 404 })
    }) as unknown as typeof fetch,
    items,
    dead,
    calls,
    failAck,
    post: (i: object) => {
      items.set((i as { client_id: string }).client_id, i)
      marker++
    },
  }
  return w
}

const stateDir = () => mkdtempSync(join(tmpdir(), 'inbox-'))
const statePath = () => join(stateDir(), 'state.json')

/** A fake bd that keeps comments per bead, like the real one would. */
function fakeBd(opts: { fail?: (body: string) => boolean } = {}) {
  const comments: { bead: string; body: string }[] = []
  const runs: string[][] = []
  const events: string[] = []
  let dead = false
  let dieAfterWrite = false
  const runBd: RunBd = (args) => {
    if (dead) return Promise.reject(new Error('process killed'))
    if (args[1] === 'add') {
      const body = args[5]
      if (opts.fail?.(body)) return Promise.reject(new Error('bd exploded'))
      runs.push(args)
      comments.push({ bead: args[4], body })
      events.push(`apply ${body.split('\n')[0]}`)
      if (dieAfterWrite) {
        dead = true // the comment is in bd, then the process dies
        return Promise.reject(new Error('process killed'))
      }
      return Promise.resolve('')
    }
    const bead = args[1]
    return Promise.resolve(
      JSON.stringify(comments.filter((c) => c.bead === bead)),
    )
  }
  return {
    runBd,
    runs,
    events,
    comments,
    dieAfterWrite: () => (dieAfterWrite = true),
    revive: () => {
      dead = false
      dieAfterWrite = false
    },
  }
}

const base = (
  w: ReturnType<typeof fakeWorker>,
  runBd: RunBd,
  path: string,
  log: (l: string) => void = () => {},
) => ({
  baseUrl: BASE,
  token: TOKEN,
  statePath: path,
  runBd,
  fetch: w.fetch,
  log,
})

describe('applyInbox', () => {
  it('applies each item in order, records it, then acks it', async () => {
    const w = fakeWorker([item(2), item(1)])
    const path = statePath()
    const bd = fakeBd()
    // Observe the record at ack time: it must already hold the id and no pending item.
    const realFetch = w.fetch
    w.fetch = (async (u: string, i: RequestInit) => {
      if (i.method === 'DELETE') {
        const rec = JSON.parse(readFileSync(path, 'utf8')) as {
          applied: string[]
          pending: unknown
        }
        bd.events.push(
          `ack recorded=${rec.applied.includes(u.split('/').pop()!)} pending=${rec.pending}`,
        )
      }
      return realFetch(u, i)
    }) as typeof fetch
    const r = await applyInbox(base(w, bd.runBd, path))
    expect(r).toMatchObject({ applied: 2, acked: 2, failed: 0, dead: 0 })
    expect(bd.events).toEqual([
      'apply comment 1',
      'ack recorded=true pending=null',
      'apply comment 2',
      'ack recorded=true pending=null',
    ])
    expect(w.items.size).toBe(0)
  })

  it('saves the pending item before bd runs', async () => {
    const w = fakeWorker([item(1)])
    const path = statePath()
    let seen: unknown
    const runBd: RunBd = (args) => {
      if (args[1] === 'add')
        seen = (JSON.parse(readFileSync(path, 'utf8')) as { pending: unknown })
          .pending
      return Promise.resolve('')
    }
    await applyInbox(base(w, runBd, path))
    expect(seen).toEqual({ id: id(1), bead: 'demo-1' })
  })

  it('passes bd an args array: injection stays literal and the author cannot pose as an actor', async () => {
    const evil = '"; rm -rf ~ #\n$(touch /tmp/pwned) `id` --help -f /etc/passwd'
    const w = fakeWorker([item(1, { body: evil, author: 'Eve $(id)' })])
    const bd = fakeBd()
    await applyInbox(base(w, bd.runBd, statePath()))
    expect(bd.runs).toEqual([
      [
        'comments',
        'add',
        '--author=Eve $(id) (inbox)',
        '--',
        'demo-1',
        `${evil}\n\n(via inbox, ${id(1)})`,
      ],
    ])
  })

  it('never reaches bd with an invalid item: it is dead-lettered, not stuck', async () => {
    const w = fakeWorker([
      item(1, { bead: '-rf' }),
      item(2, { op: 'issue.close' }),
      item(3, { body: 'a\0b' }),
      item(4, { body: 'esc\u001b[2J' }),
    ])
    const bd = fakeBd()
    const logs: string[] = []
    const r = await applyInbox(
      base(w, bd.runBd, statePath(), (l) => logs.push(l)),
    )
    expect(bd.runs).toEqual([])
    expect(r).toMatchObject({ applied: 0, dead: 4, failed: 0 })
    expect(w.items.size).toBe(0)
    expect(w.dead.size).toBe(4)
    expect(logs.join('\n')).not.toContain('\u001b')
  })

  it('leaves an invalid item with no usable client_id in the queue and reports it', async () => {
    const w = fakeWorker([{ op: 'comment.add', client_id: 'nope' }])
    const logs: string[] = []
    const r = await applyInbox(
      base(w, fakeBd().runBd, statePath(), (l) => logs.push(l)),
    )
    expect(r).toMatchObject({ dead: 0, failed: 1 })
    expect(w.items.size).toBe(1)
    expect(logs[0]).toMatch(/^invalid item: "/) // quoted by show()
  })

  it('keeps the item when bd fails, and retries it next run', async () => {
    const w = fakeWorker([item(1), item(2)])
    const path = statePath()
    const logs: string[] = []
    let broken = true
    const bd = fakeBd({ fail: (b) => broken && b.startsWith('comment 1') })
    const r1 = await applyInbox(base(w, bd.runBd, path, (l) => logs.push(l)))
    expect(r1).toMatchObject({ applied: 1, acked: 1, failed: 1, dead: 0 })
    expect([...w.items.keys()]).toEqual([id(1)])
    expect(logs.join('\n')).toMatch(/bd failed for 0{8}-0{4}-4000-8000-0{11}1/)
    // The failed run must not remember the marker, or the item would wait for the next POST.
    broken = false
    const r2 = await applyInbox(base(w, bd.runBd, path))
    expect(r2).toMatchObject({ applied: 1, acked: 1, failed: 0 })
    expect(bd.runs.map((a) => a[5].split('\n')[0])).toEqual([
      'comment 2',
      'comment 1',
    ])
    expect(w.items.size).toBe(0)
  })

  it('dead-letters an item bd rejects three times, so it cannot stall the queue', async () => {
    const w = fakeWorker([item(1), item(2)])
    const path = statePath()
    const bd = fakeBd({ fail: (b) => b.startsWith('comment 1') })
    for (const failed of [1, 1]) {
      const r = await applyInbox(base(w, bd.runBd, path))
      expect(r).toMatchObject({ failed, dead: 0 })
    }
    const r3 = await applyInbox(base(w, bd.runBd, path))
    expect(r3).toMatchObject({ failed: 0, dead: 1 })
    expect([...w.dead.keys()]).toEqual([id(1)])
    expect(w.items.size).toBe(0)
    // Clean again: the marker was remembered, so the next run does not even list.
    const idle = await applyInbox(base(w, bd.runBd, path))
    expect(idle.skipped).toBe('marker-unchanged')
  })

  it('applies once across a crash between apply and ack', async () => {
    const w = fakeWorker([item(1)])
    const path = statePath()
    const bd = fakeBd()
    const dying = w.fetch
    w.fetch = (async (u: string, i: RequestInit) => {
      if (i.method === 'DELETE') throw new Error('process killed')
      return dying(u, i)
    }) as typeof fetch
    await expect(applyInbox(base(w, bd.runBd, path))).rejects.toThrow('killed')
    expect(bd.runs).toHaveLength(1)
    expect(w.items.size).toBe(1)
    w.fetch = dying
    const r = await applyInbox(base(w, bd.runBd, path))
    expect(bd.runs).toHaveLength(1)
    expect(r).toMatchObject({ applied: 0, acked: 1, failed: 0 })
    expect(w.items.size).toBe(0)
  })

  it('applies once across a crash between bd and the local record', async () => {
    const w = fakeWorker([item(1)])
    const path = statePath()
    const bd = fakeBd()
    bd.dieAfterWrite() // bd stored the comment, then the process died before saving anything
    await expect(applyInbox(base(w, bd.runBd, path))).rejects.toThrow('killed')
    expect(bd.comments).toHaveLength(1)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({
      pending: { id: id(1) },
      applied: [],
    })
    // A fresh process finds the footer in bd's comments: it only acks.
    bd.revive()
    const r = await applyInbox(base(w, bd.runBd, path))
    expect(bd.comments).toHaveLength(1)
    expect(r).toMatchObject({ applied: 0, acked: 1, failed: 0 })
    expect(w.items.size).toBe(0)
  })

  it('retries an item whose pending bd call never wrote anything', async () => {
    const w = fakeWorker([item(1)])
    const path = statePath()
    writeFileSync(
      path,
      JSON.stringify({
        applied: [],
        marker: null,
        pending: { id: id(1), bead: 'demo-1' },
        attempts: {},
      }),
    )
    const bd = fakeBd()
    const r = await applyInbox(base(w, bd.runBd, path))
    expect(bd.runs).toEqual([sent(1)])
    expect(r).toMatchObject({ applied: 1, acked: 1 })
  })

  it('does not re-apply an acked id that the viewer queues again', async () => {
    const w = fakeWorker([item(1)])
    const path = statePath()
    const bd = fakeBd()
    await applyInbox(base(w, bd.runBd, path))
    w.post(item(1)) // the viewer retried after the ack
    await applyInbox(base(w, bd.runBd, path))
    expect(bd.runs).toHaveLength(1)
    expect(w.items.size).toBe(0)
  })

  it('keeps the item when the ack fails, and does not apply it twice', async () => {
    const w = fakeWorker([item(1)])
    const path = statePath()
    const bd = fakeBd()
    w.failAck.add(id(1))
    const r1 = await applyInbox(base(w, bd.runBd, path))
    expect(r1).toMatchObject({ applied: 1, acked: 0, failed: 1 })
    w.failAck.clear()
    const r2 = await applyInbox(base(w, bd.runBd, path))
    expect(r2).toMatchObject({ applied: 0, acked: 1, failed: 0 })
    expect(bd.runs).toHaveLength(1)
  })

  it('follows the list cursor through every page', async () => {
    const w = fakeWorker([item(1), item(2), item(3), item(4), item(5)], 2)
    const bd = fakeBd()
    const r = await applyInbox(base(w, bd.runBd, statePath()))
    expect(r).toMatchObject({ applied: 5, acked: 5, failed: 0 })
    expect(w.calls.filter((c) => c === 'GET /inbox')).toHaveLength(3)
    expect(w.items.size).toBe(0)
  })

  it('lists only when the marker moved', async () => {
    const w = fakeWorker([item(1)])
    const path = statePath()
    const bd = fakeBd()
    await applyInbox(base(w, bd.runBd, path))
    w.calls.length = 0
    const idle = await applyInbox(base(w, bd.runBd, path))
    expect(idle.skipped).toBe('marker-unchanged')
    expect(w.calls).toEqual(['GET /inbox/_marker'])
    w.post(item(2))
    const next = await applyInbox(base(w, bd.runBd, path))
    expect(next).toMatchObject({ applied: 1, skipped: null })
  })

  it('--dry-run prints the commands and changes nothing', async () => {
    const w = fakeWorker([item(1, { body: 'esc\u000bx' }), item(2)])
    const path = statePath()
    const logs: string[] = []
    const bd = fakeBd()
    await applyInbox({
      ...base(w, bd.runBd, path, (l) => logs.push(l)),
      dryRun: true,
    })
    expect(bd.runs).toEqual([])
    expect(w.items.size).toBe(2) // nothing acked, nothing dead-lettered
    expect(w.dead.size).toBe(0)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(`${path}.lock`)).toBe(false)
    expect(logs.some((l) => l.includes('would run bd "comments" "add"'))).toBe(
      true,
    )
    expect(logs.join('\n')).not.toContain('\u000b')
    const again = await applyInbox(base(w, bd.runBd, path))
    expect(again.applied).toBe(1) // the dry run recorded no marker and no id
  })

  it('never writes the token to the log, the state file or a thrown error', async () => {
    const w = fakeWorker([item(1), item(2, { bead: '-bad' }), item(3)])
    const path = statePath()
    const logs: string[] = []
    const bd = fakeBd({ fail: (b) => b.startsWith('comment 1') })
    await applyInbox(base(w, bd.runBd, path, (l) => logs.push(l)))
    const bad = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch
    const err = await applyInbox({
      ...base(w, bd.runBd, path),
      fetch: bad,
    }).catch((e: Error) => e)
    expect((err as Error).message).toMatch(/HTTP 500/)
    const all = [
      logs.join('\n'),
      (err as Error).message,
      readFileSync(path, 'utf8'),
    ].join('\n')
    expect(all).not.toContain(TOKEN)
  })

  it('stops on a corrupt state file instead of starting empty', async () => {
    const path = statePath()
    writeFileSync(path, '{not json')
    const w = fakeWorker([item(1)])
    const bd = fakeBd()
    await expect(applyInbox(base(w, bd.runBd, path))).rejects.toThrow()
    expect(bd.runs).toEqual([])
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('refuses plain http for a remote host', async () => {
    await expect(
      applyInbox({
        ...base(fakeWorker(), fakeBd().runBd, statePath()),
        baseUrl: 'http://snapshots.example.com',
      }),
    ).rejects.toThrow(/https/)
  })
})

describe('run lock', () => {
  it('refuses a second run while the first holds the lock, and leaves its lock alone', async () => {
    const path = statePath()
    writeFileSync(`${path}.lock`, String(process.pid)) // a live owner
    const w = fakeWorker([item(1)])
    const bd = fakeBd()
    await expect(applyInbox(base(w, bd.runBd, path))).rejects.toThrow(
      'another run in progress',
    )
    expect(bd.runs).toEqual([])
    expect(readFileSync(`${path}.lock`, 'utf8')).toBe(String(process.pid))
  })

  it('refuses a real overlapping run', async () => {
    const path = statePath()
    const w = fakeWorker([item(1)])
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow: RunBd = async (args) => {
      await gate
      return fakeBd().runBd(args)
    }
    const first = applyInbox(base(w, slow, path))
    await new Promise((r) => setTimeout(r, 20))
    await expect(applyInbox(base(w, fakeBd().runBd, path))).rejects.toThrow(
      'another run in progress',
    )
    release()
    await first
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('takes over a stale lock whose process is gone', async () => {
    const path = statePath()
    const gone = spawnSync(process.execPath, ['-e', '']).pid
    writeFileSync(`${path}.lock`, String(gone))
    const w = fakeWorker([item(1)])
    const bd = fakeBd()
    const r = await applyInbox(base(w, bd.runBd, path))
    expect(r.applied).toBe(1)
    expect(existsSync(`${path}.lock`)).toBe(false)
  })

  it('does not treat an unreadable lock as stale', async () => {
    const path = statePath()
    writeFileSync(`${path}.lock`, '')
    await expect(
      applyInbox(base(fakeWorker(), fakeBd().runBd, path)),
    ).rejects.toThrow('another run in progress')
  })

  it('releases the lock when the run throws', async () => {
    const path = statePath()
    const bad = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch
    await expect(
      applyInbox({ ...base(fakeWorker(), fakeBd().runBd, path), fetch: bad }),
    ).rejects.toThrow(/HTTP 500/)
    expect(existsSync(`${path}.lock`)).toBe(false)
  })
})

describe('bdRunner', () => {
  const script = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'inbox-bd-'))
    const file = join(dir, 'fake-bd.mjs')
    writeFileSync(file, `#!/usr/bin/env node\n${body}`, { mode: 0o755 })
    return { dir, file }
  }

  it('runs without a shell, so the body is one literal argument, strips the token and returns stdout', async () => {
    const { dir, file } = script(
      `console.log(JSON.stringify({ argv: process.argv.slice(2), token: process.env.SNAPSHOT_WRITE_TOKEN ?? null }))`,
    )
    process.env['SNAPSHOT_WRITE_TOKEN'] = TOKEN
    let out: string
    const body = '; touch pwned && echo $(id) `id` | cat'
    try {
      out = await bdRunner(
        file,
        dir,
      )(
        bdArgs({
          op: 'comment.add',
          bead: 'demo-1',
          body,
          author: 'Ada',
          client_id: id(1),
        }),
      )
    } finally {
      delete process.env['SNAPSHOT_WRITE_TOKEN']
    }
    const seen = JSON.parse(out) as { argv: string[]; token: string | null }
    expect(seen.argv).toEqual([
      'comments',
      'add',
      '--author=Ada (inbox)',
      '--',
      'demo-1',
      `${body}\n\n(via inbox, ${id(1)})`,
    ])
    expect(seen.token).toBeNull()
  })

  it('rejects with bd stderr when the command fails', async () => {
    const { dir, file } = script(
      `console.error('no such issue')\nprocess.exit(1)\n`,
    )
    await expect(bdRunner(file, dir)(['comments'])).rejects.toThrow(
      'no such issue',
    )
  })
})
