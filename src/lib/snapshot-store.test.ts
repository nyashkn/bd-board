import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { activateRum, resetRumForTests, tracked } from './rum.ts'
import { createRefresher } from './snapshot-refresh.ts'
import {
  isFeedLive,
  patchSnapshot,
  refreshComments,
  refreshSnapshot,
  setFeedLive,
  settleWrite,
  snapshotKey,
  snapshotQueryOptions,
} from './snapshot-store.ts'
import { addComment, patchBead, selectBoard, selectDetail } from './snapshot.ts'
import { buildSnapshot } from './bd.ts'
import { blockedText, exportText, readyText } from './snapshot-fixture.ts'

import type { RumSdk } from './rum.ts'
import type { ProjectSnapshot } from './snapshot.ts'
import type { Comment } from './types.ts'

const calls = {
  snapshot: vi.fn(),
  beadComments: vi.fn(),
  listBeads: vi.fn(),
  beadDetail: vi.fn(),
  projectKnowledge: vi.fn(),
}

vi.mock('@/lib/core', () => ({
  connectorFor: () => ({
    // the real wrappers, so RUM sees exactly what it sees in the app
    snapshot: tracked('snapshot', calls.snapshot),
    beadComments: tracked('comments', calls.beadComments),
    listBeads: tracked('list', calls.listBeads),
    beadDetail: tracked('show', calls.beadDetail),
    projectKnowledge: tracked('export', calls.projectKnowledge),
  }),
}))

const fresh = () => buildSnapshot(exportText, readyText, blockedText)
const rumCalls: string[] = []

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  })
}

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset()
  calls.snapshot.mockImplementation(async () => fresh())
  rumCalls.length = 0
  const sdk: RumSdk = {
    init: () => {},
    startView: () => {},
    addAction: () => {},
    addError: () => {},
    addDurationVital: (name) => rumCalls.push(name),
    setUser: () => {},
  }
  activateRum({
    config: {
      site: 'x',
      organizationIdentifier: 'x',
      applicationName: 'x',
      clientToken: 'x',
      env: 'test',
      profile: 'full',
      insecureHTTP: true,
      sampleRate: 100,
      replaySampleRate: 100,
    },
    sdk,
    desktop: false,
    version: '1',
  })
})
afterEach(() => resetRumForTests())

describe('opening a bead from a warm snapshot', () => {
  it('makes zero bd calls and emits no bd.call', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    expect(rumCalls).toEqual(['bd.call.snapshot'])
    rumCalls.length = 0

    // The board, then the modal open and switch between beads, as observers on the same key.
    const board = new QueryObserver(client, {
      ...snapshotQueryOptions('p'),
      select: selectBoard,
    })
    const unsubscribe = board.subscribe(() => {})
    for (const id of ['syn-1.1', 'syn-2', 'syn-4', 'syn-1.1']) {
      const detail = new QueryObserver(client, {
        ...snapshotQueryOptions('p'),
        select: (s: ProjectSnapshot) => selectDetail(s, id),
      })
      expect(detail.getCurrentResult().data?.id).toBe(id)
      const stop = detail.subscribe(() => {})
      stop()
    }
    unsubscribe()
    await Promise.resolve()

    expect(rumCalls).toEqual([])
    expect(calls.snapshot).toHaveBeenCalledTimes(1)
    for (const other of [
      calls.listBeads,
      calls.beadDetail,
      calls.projectKnowledge,
    ])
      expect(other).not.toHaveBeenCalled()
  })
})

describe('refresh', () => {
  it('a change during an in-flight fetch gets a run that began after the change', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    calls.snapshot.mockClear()
    // A mount refetch is under way and will answer with the old state.
    let stale!: (s: ProjectSnapshot) => void
    calls.snapshot.mockReturnValueOnce(new Promise((r) => (stale = r)))
    const stop = new QueryObserver(client, snapshotQueryOptions('p')).subscribe(
      () => {},
    )
    const mount = client.refetchQueries({ queryKey: snapshotKey('p') })
    // The agent's change lands; the refresh it triggers must not join that fetch.
    const changed = buildSnapshot(
      exportText.replace('"status":"in_progress"', '"status":"closed"'),
      readyText,
      blockedText,
    )
    calls.snapshot.mockResolvedValueOnce(changed)
    await refreshSnapshot(client, 'p')
    stale(fresh())
    await mount
    expect(calls.snapshot).toHaveBeenCalledTimes(2)
    expect(
      selectDetail(client.getQueryData(snapshotKey('p'))!, 'syn-2')?.status,
    ).toBe('closed')
    stop()
  })

  it('refreshes of a loaded snapshot take the background lane; the first load does not', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    await refreshSnapshot(client, 'p')
    expect(calls.snapshot.mock.calls.map((c) => c[0].data.background)).toEqual([
      false,
      true,
    ])
  })

  it('many comment-only ids cost one snapshot, not one bd comments call each', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    calls.snapshot.mockClear()
    await refreshComments(client, 'p', ['a', 'b', 'c', 'd'])
    expect(calls.beadComments).not.toHaveBeenCalled()
    expect(calls.snapshot).toHaveBeenCalledTimes(1)
  })

  it('a comment-only change fetches that bead comments and patches, with no snapshot call', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    calls.snapshot.mockClear()
    const added: Comment = { id: 'n1', text: 'from an agent' }
    calls.beadComments.mockResolvedValue([added])
    await refreshComments(client, 'p', ['syn-2'])
    const detail = selectDetail(client.getQueryData(snapshotKey('p'))!, 'syn-2')
    expect(detail?.comments).toEqual([added])
    expect(detail?.comment_count).toBe(1)
    expect(calls.beadComments).toHaveBeenCalledTimes(1)
    expect(calls.snapshot).not.toHaveBeenCalled()
  })

  it('an unknown bead or a failed fetch falls back to a full snapshot', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    calls.snapshot.mockClear()
    calls.beadComments.mockResolvedValue([])
    await refreshComments(client, 'p', ['syn-new'])
    expect(calls.snapshot).toHaveBeenCalledTimes(1)
    calls.beadComments.mockRejectedValue(new Error('boom'))
    await refreshComments(client, 'p', ['syn-2'])
    expect(calls.snapshot).toHaveBeenCalledTimes(2)
  })
})

describe('optimistic write, then the feed confirms', () => {
  it('patches at once, cancels a stale in-flight refresh, and the feed refresh replaces the patch', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    setFeedLive('p', true)

    // A refresh is in flight and will return the old state.
    let finish!: (s: ProjectSnapshot) => void
    calls.snapshot.mockReturnValueOnce(new Promise((r) => (finish = r)))
    const inFlight = refreshSnapshot(client, 'p')

    const rollback = await patchSnapshot(client, 'p', (s) =>
      patchBead(addComment(s, 'syn-2', { id: 'tmp', text: 'mine' }), 'syn-2', {
        status: 'closed',
      }),
    )
    finish(fresh())
    await inFlight
    const patched = client.getQueryData<ProjectSnapshot>(snapshotKey('p'))!
    expect(selectDetail(patched, 'syn-2')?.status).toBe('closed')
    expect(selectDetail(patched, 'syn-2')?.comments?.map((c) => c.id)).toEqual([
      'tmp',
    ])

    // The write succeeded and the feed is live: no refetch of our own.
    calls.snapshot.mockClear()
    settleWrite(client, 'p')
    expect(calls.snapshot).not.toHaveBeenCalled()

    // The feed event arrives and the paced refresh brings the server truth.
    vi.useFakeTimers()
    calls.snapshot.mockImplementation(async () =>
      buildSnapshot(
        exportText.replace('"status":"in_progress"', '"status":"closed"'),
        readyText,
        blockedText,
      ),
    )
    const refresher = createRefresher({
      full: () => refreshSnapshot(client, 'p'),
      comments: () => Promise.resolve(),
    })
    refresher.change({ issueIds: ['syn-2'], ops: ['update'] })
    await vi.advanceTimersByTimeAsync(400)
    vi.useRealTimers()
    expect(calls.snapshot).toHaveBeenCalledTimes(1)
    const confirmed = client.getQueryData<ProjectSnapshot>(snapshotKey('p'))!
    expect(selectDetail(confirmed, 'syn-2')?.status).toBe('closed')
    expect(selectDetail(confirmed, 'syn-2')?.comments).toEqual([])
    expect(rollback).toBeTypeOf('function')
  })

  it('a failed write rolls back, and without a live feed the write refetches', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    const rollback = await patchSnapshot(client, 'p', (s) =>
      patchBead(s, 'syn-2', { status: 'closed' }),
    )
    rollback()
    expect(
      selectDetail(client.getQueryData(snapshotKey('p'))!, 'syn-2')?.status,
    ).toBe('in_progress')

    setFeedLive('p', false)
    expect(isFeedLive('p')).toBe(false)
    // The board is on screen: an active observer.
    const stop = new QueryObserver(client, snapshotQueryOptions('p')).subscribe(
      () => {},
    )
    calls.snapshot.mockClear()
    settleWrite(client, 'p')
    await vi.waitFor(() => expect(calls.snapshot).toHaveBeenCalledTimes(1))
    stop()
  })

  it('a write that cancels a running feed refresh runs it again, so the agent change lands', async () => {
    const client = newClient()
    await client.fetchQuery(snapshotQueryOptions('p'))
    setFeedLive('p', true)
    const stop = new QueryObserver(client, snapshotQueryOptions('p')).subscribe(
      () => {},
    )
    // An agent closed syn-2; the refresh for it is running and will not finish before the write.
    const withAgent = buildSnapshot(
      exportText.replace('"status":"in_progress"', '"status":"closed"'),
      readyText,
      blockedText,
    )
    let slow!: (s: ProjectSnapshot) => void
    calls.snapshot.mockClear()
    calls.snapshot.mockReturnValueOnce(new Promise((r) => (slow = r)))
    calls.snapshot.mockResolvedValue(withAgent)
    const refresh = refreshSnapshot(client, 'p')

    // Meanwhile the user comments on syn-4: the patch cancels the running refresh.
    await patchSnapshot(client, 'p', (s) =>
      addComment(s, 'syn-4', { id: 'tmp', text: 'mine' }),
    )
    slow(withAgent)
    await refresh
    expect(
      selectDetail(client.getQueryData(snapshotKey('p'))!, 'syn-2')?.status,
    ).toBe('in_progress') // the cancelled refresh left no trace

    settleWrite(client, 'p')
    await vi.waitFor(() =>
      expect(
        selectDetail(client.getQueryData(snapshotKey('p'))!, 'syn-2')?.status,
      ).toBe('closed'),
    )
    stop()
    setFeedLive('p', false)
  })
})
