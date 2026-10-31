import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectorFor, resetConnectorsForTests } from '@/lib/core'
import * as server from '@/lib/server'
import { buildSnapshot } from '@/lib/bd'
import { exportText } from '@/lib/snapshot-fixture'

import { httpSnapshotConnector } from './http-snapshot'

vi.mock('@/lib/server', () => ({
  addCommentFn: vi.fn(),
  createBeadFn: vi.fn(),
  deleteBeadFn: vi.fn(),
  enableEventsJournalFn: vi.fn(),
  getBeadDetailFn: vi.fn(),
  getBeadCommentsFn: vi.fn(),
  getBeads: vi.fn(),
  getCommentAuthorFn: vi.fn(),
  getHttpSnapshotFn: vi.fn(),
  getProjectKnowledgeFn: vi.fn(),
  getSnapshotFn: vi.fn(),
  isDesktopApp: vi.fn(() => false),
  previewDeleteBeadFn: vi.fn(),
  probeDoltModeFn: vi.fn(),
  readArtifactFn: vi.fn(),
  subscribeBeadFeed: vi.fn(),
  updateBeadFn: vi.fn(),
  updateBeadStatusFn: vi.fn(),
}))
vi.mock('@/lib/rum', () => ({ rumAction: vi.fn() }))

const SRC = 'https://snap.example.com/manifest.json'
const snapshot = {
  ...buildSnapshot(exportText, undefined, undefined),
  cursor: 'h1',
}
const fetchSnap = vi.mocked(server.getHttpSnapshotFn)
const arg = { data: { project: 'p' } }

describe('http-snapshot connector inside the router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetConnectorsForTests()
    vi.mocked(server.probeDoltModeFn).mockResolvedValue({
      error: 'not probed: explicit sources',
      sources: [SRC, 'bd:'],
    })
  })

  it('reads through the first https source and reports its id', async () => {
    fetchSnap.mockResolvedValue({ cursor: 'h1', snapshot })
    const c = connectorFor('p')
    const out = await c.snapshot(arg)
    expect(out.cursor).toBe('h1')
    expect(fetchSnap).toHaveBeenCalledWith({
      data: { project: 'p', source: SRC },
    })
    expect(c.id).toBe('http-snapshot')
    expect(server.getSnapshotFn).not.toHaveBeenCalled()
  })

  it('falls back to the next source on a 5xx or network error', async () => {
    fetchSnap.mockRejectedValue(
      new Error('snapshot source unavailable: network error'),
    )
    vi.mocked(server.getSnapshotFn).mockResolvedValue(snapshot)
    const c = connectorFor('p')
    await c.snapshot(arg)
    expect(server.getSnapshotFn).toHaveBeenCalledTimes(1)
    expect(c.id).toBe('bd-cli')
  })

  it('does not fall back on a rejected token', async () => {
    fetchSnap.mockRejectedValue(
      new Error(
        'snapshot token rejected (HTTP 401): check the token behind credentials_ref',
      ),
    )
    await expect(connectorFor('p').snapshot(arg)).rejects.toThrow(
      /token rejected/,
    )
    expect(server.getSnapshotFn).not.toHaveBeenCalled()
  })

  it('writes are refused as read-only: no retry, no fallback', async () => {
    const c = connectorFor('p')
    await expect(
      c.updateStatus({ data: { project: 'p', id: 'syn-1', status: 'open' } }),
    ).rejects.toThrow(/read-only/)
    await expect(
      c.addComment({ data: { project: 'p', id: 'syn-1', text: 'x' } }),
    ).rejects.toThrow(/read-only/)
    expect(server.updateBeadStatusFn).not.toHaveBeenCalled()
    expect(server.addCommentFn).not.toHaveBeenCalled()
  })
})

describe('http-snapshot connector feed', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('polls the manifest every interval and signals a new head', async () => {
    const heads = ['a', 'a', 'b']
    const peek = vi.fn(async () => ({ cursor: heads.shift() ?? 'b' }))
    const msgs: string[] = []
    const stop = httpSnapshotConnector(SRC, peek, 30_000).subscribeFeed(
      'p',
      0,
      (m) => msgs.push(m.type),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(msgs).toEqual(['live'])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(msgs).toEqual(['live']) // same head
    await vi.advanceTimersByTimeAsync(30_000)
    expect(msgs).toEqual(['live', 'change'])
    expect(peek).toHaveBeenCalledWith({
      data: { project: 'p', source: SRC, peek: true },
    })
    stop()
    await vi.advanceTimersByTimeAsync(90_000)
    expect(peek).toHaveBeenCalledTimes(3)
  })

  it('stops polling on a rejected token instead of retrying', async () => {
    const peek = vi.fn(async () => {
      throw new Error('snapshot token rejected (HTTP 401): check it')
    })
    const msgs: string[] = []
    httpSnapshotConnector(SRC, peek).subscribeFeed('p', 0, (m) =>
      msgs.push(m.type),
    )
    await vi.advanceTimersByTimeAsync(120_000)
    expect(msgs).toEqual(['unsupported'])
    expect(peek).toHaveBeenCalledTimes(1)
  })
})
