import { beforeEach, describe, expect, it, vi } from 'vitest'

import { invoke } from '@tauri-apps/api/core'

import { bdCli } from './bd-cli'
import { doltSql } from './dolt-sql'

import type { ProjectSnapshot } from '../snapshot'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (m: unknown) => void = () => {}
  },
  isTauri: () => true,
}))
vi.mock('./bd-cli.ts', () => ({
  bdCli: {
    id: 'bd-cli',
    addComment: vi.fn(),
    updateBead: vi.fn(),
    createBead: vi.fn(),
    deleteBead: vi.fn(),
  },
}))

const bead = (id: string, title: string) => ({
  id,
  title,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  comments: [{ id: 'c1', text: 'hi' }],
  edges: [],
})

const snap = {
  beads: [bead('syn-1', 'One'), bead('syn-2', 'Two')],
  ready: null,
  blocked: null,
  cursor: 'c',
  readiness_unavailable: true,
} as unknown as ProjectSnapshot

const arg = { data: { project: 'p' } }

beforeEach(() => {
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValue(snap)
})

describe('dolt-sql connector', () => {
  it('names only the project: the Rust side picks the server', async () => {
    expect(await doltSql.snapshot(arg)).toBe(snap)
    expect(invoke).toHaveBeenCalledWith('dolt_sql_snapshot', {
      projectId: 'p',
      background: false,
    })
  })

  it('derives the list, a bead and the knowledge from the one snapshot', async () => {
    expect((await doltSql.listBeads(arg)).map((b) => b.id)).toEqual([
      'syn-1',
      'syn-2',
    ])
    const detail = await doltSql.beadDetail({
      data: { project: 'p', id: 'syn-2' },
    })
    expect(detail.title).toBe('Two')
    await expect(
      doltSql.beadDetail({ data: { project: 'p', id: 'nope' } }),
    ).rejects.toThrow(/not found/)
    expect((await doltSql.projectKnowledge(arg)).comments).toHaveLength(2)
    expect(
      vi.mocked(invoke).mock.calls.every((c) => c[0] === 'dolt_sql_snapshot'),
    ).toBe(true)
  })

  it('reads comments over SQL and sends every write to bd', async () => {
    vi.mocked(invoke).mockResolvedValue([])
    await doltSql.beadComments({ data: { project: 'p', id: 'syn-1' } })
    expect(invoke).toHaveBeenCalledWith('dolt_sql_comments', {
      projectId: 'p',
      id: 'syn-1',
      background: false,
    })
    // writes are the very same functions bd-cli uses
    expect(doltSql.addComment).toBe(bdCli.addComment)
    expect(doltSql.updateBead).toBe(bdCli.updateBead)
    expect(doltSql.createBead).toBe(bdCli.createBead)
    expect(doltSql.deleteBead).toBe(bdCli.deleteBead)
  })

  it('feed: watches over the probe command and reports a failed start as an error', async () => {
    vi.mocked(invoke).mockRejectedValue(
      'source unavailable (dolt-sql): connection refused',
    )
    const seen: unknown[] = []
    const stop = doltSql.subscribeFeed('p', 0, (m) => seen.push(m))
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0]).toEqual({
      type: 'error',
      message: 'source unavailable (dolt-sql): connection refused',
    })
    expect(invoke).toHaveBeenCalledWith(
      'watch_dolt_feed',
      expect.objectContaining({ projectId: 'p' }),
    )
    stop()
  })
})
