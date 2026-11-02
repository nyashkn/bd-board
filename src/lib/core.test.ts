import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  bdCli,
  connectorFor,
  registerConnectorKind,
  resetConnectorsForTests,
} from '@/lib/core'
import type { Connector } from '@/lib/core'
import * as rum from '@/lib/rum'
import * as server from '@/lib/server'

vi.mock('@/lib/server', () => ({
  addCommentFn: vi.fn(),
  createBeadFn: vi.fn(),
  deleteBeadFn: vi.fn(),
  enableEventsJournalFn: vi.fn(),
  getBeadDetailFn: vi.fn(),
  getBeadCommentsFn: vi.fn(),
  getBeads: vi.fn(),
  getCommentAuthorFn: vi.fn(),
  getProjectKnowledgeFn: vi.fn(),
  getSnapshotFn: vi.fn(),
  getHttpSnapshotFn: vi.fn(),
  isDesktopApp: vi.fn(() => false),
  previewDeleteBeadFn: vi.fn(),
  probeDoltModeFn: vi.fn(),
  readArtifactFn: vi.fn(),
  subscribeBeadFeed: vi.fn(),
  updateBeadFn: vi.fn(),
  updateBeadStatusFn: vi.fn(),
}))

vi.mock('@/lib/rum', () => ({
  rumAction: vi.fn(),
  tracked: <T>(_cmd: string, fn: T) => fn,
}))

const probe = vi.mocked(server.probeDoltModeFn)
const SERVER = {
  embedded: false,
  connectionOk: true,
  host: 'h',
  port: 1,
  database: 'd',
}
const arg = { data: { project: 'p' } }

/** A stand-in dolt-sql connector whose listBeads behaves as the test says. */
function fakeDolt(listBeads: ReturnType<typeof vi.fn>) {
  registerConnectorKind('dolt-sql', () => ({
    ...bdCli,
    id: 'dolt-sql',
    listBeads: listBeads as Connector['listBeads'],
  }))
}

describe('connectorFor router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetConnectorsForTests()
    probe.mockResolvedValue({ embedded: true })
    vi.mocked(server.getBeads).mockResolvedValue([])
  })

  it('is one router per project, not the bd-cli object', () => {
    expect(connectorFor('p')).toBe(connectorFor('p'))
    expect(connectorFor('p')).not.toBe(connectorFor('q'))
  })

  it('uses bd-cli and probes once per project per session', async () => {
    const c = connectorFor('p')
    await c.listBeads(arg)
    await c.listBeads(arg)
    expect(server.getBeads).toHaveBeenCalledTimes(2)
    expect(probe).toHaveBeenCalledTimes(1)
    expect(c.id).toBe('bd-cli')
  })

  it('falls back to bd-cli when the probe call itself fails', async () => {
    probe.mockRejectedValue(new Error('no such command'))
    await connectorFor('p').listBeads(arg)
    expect(server.getBeads).toHaveBeenCalledTimes(1)
  })

  it('skips kinds with no registered factory', async () => {
    probe.mockResolvedValue(SERVER)
    const c = connectorFor('p')
    await c.listBeads(arg)
    expect(server.getBeads).toHaveBeenCalledTimes(1)
    expect(c.id).toBe('bd-cli')
    expect(rum.rumAction).not.toHaveBeenCalled()
  })

  it('errors with the unavailable kinds when nothing is usable', async () => {
    probe.mockResolvedValue({
      error: 'not probed: explicit sources',
      sources: ['mysql://h:1/d'],
    })
    await expect(connectorFor('p').listBeads(arg)).rejects.toThrow(/dolt-sql/)
  })

  it('falls back on a connection error, emits one event and sticks', async () => {
    probe.mockResolvedValue(SERVER)
    const dolt = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
    fakeDolt(dolt)
    const c = connectorFor('p')
    await c.listBeads(arg)
    await c.listBeads(arg)
    expect(dolt).toHaveBeenCalledTimes(1)
    expect(server.getBeads).toHaveBeenCalledTimes(2)
    expect(rum.rumAction).toHaveBeenCalledTimes(1)
    expect(rum.rumAction).toHaveBeenCalledWith('connector.fallback', {
      from: 'dolt-sql',
      to: 'bd-cli',
    })
    expect(c.id).toBe('bd-cli')
  })

  it('does not fall back on a domain error', async () => {
    probe.mockResolvedValue(SERVER)
    const dolt = vi.fn().mockRejectedValue(new Error('bead not found: x'))
    fakeDolt(dolt)
    await expect(connectorFor('p').listBeads(arg)).rejects.toThrow(/not found/)
    expect(server.getBeads).not.toHaveBeenCalled()
    expect(rum.rumAction).not.toHaveBeenCalled()
  })

  it('rethrows the original error when every candidate fails', async () => {
    probe.mockResolvedValue(SERVER)
    const original = new Error('connect ECONNREFUSED dolt')
    fakeDolt(vi.fn().mockRejectedValue(original))
    vi.mocked(server.getBeads).mockRejectedValue(
      new Error('connect ECONNREFUSED bd'),
    )
    await expect(connectorFor('p').listBeads(arg)).rejects.toBe(original)
  })

  it('never retries a write on the next candidate, but still marks and rethrows', async () => {
    probe.mockResolvedValue(SERVER)
    const reset = Object.assign(new Error('read ECONNRESET'), {})
    registerConnectorKind('dolt-sql', () => ({
      ...bdCli,
      id: 'dolt-sql',
      createBead: vi.fn().mockRejectedValue(reset),
    }))
    const create = { data: { project: 'p', title: 't' } }
    const c = connectorFor('p')
    await expect(c.createBead(create)).rejects.toBe(reset)
    expect(server.createBeadFn).not.toHaveBeenCalled()
    expect(rum.rumAction).toHaveBeenCalledTimes(1)
    // The candidate is unhealthy now, so the next call goes to bd-cli.
    await c.listBeads(arg)
    expect(server.getBeads).toHaveBeenCalledTimes(1)
  })

  it('still retries the idempotent enableEventsJournal', async () => {
    probe.mockResolvedValue(SERVER)
    registerConnectorKind('dolt-sql', () => ({
      ...bdCli,
      id: 'dolt-sql',
      enableEventsJournal: vi
        .fn()
        .mockRejectedValue(new Error('connect ECONNREFUSED')),
    }))
    await connectorFor('p').enableEventsJournal(arg)
    expect(server.enableEventsJournalFn).toHaveBeenCalledTimes(1)
  })

  it('probes once for concurrent first calls', async () => {
    const c = connectorFor('p')
    await Promise.all([c.listBeads(arg), c.listBeads(arg), c.listBeads(arg)])
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('re-probes a failed probe after 30 s, but not a good one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      probe.mockResolvedValueOnce({ error: 'timed out' })
      const c = connectorFor('p')
      await c.listBeads(arg)
      await c.listBeads(arg)
      expect(probe).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(31_000)
      probe.mockResolvedValue({ embedded: true })
      await c.listBeads(arg)
      expect(probe).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(60_000)
      await c.listBeads(arg)
      expect(probe).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('probes each project separately', async () => {
    await connectorFor('p').listBeads(arg)
    await connectorFor('q').listBeads({ data: { project: 'q' } })
    expect(probe).toHaveBeenCalledTimes(2)
  })
})

describe('bdCli', () => {
  it('maps each member to the server.ts export itself', () => {
    expect(bdCli.listBeads).toBe(server.getBeads)
    expect(bdCli.beadDetail).toBe(server.getBeadDetailFn)
    expect(bdCli.projectKnowledge).toBe(server.getProjectKnowledgeFn)
    expect(bdCli.readArtifact).toBe(server.readArtifactFn)
    expect(bdCli.subscribeFeed).toBe(server.subscribeBeadFeed)
    expect(bdCli.commentAuthor).toBe(server.getCommentAuthorFn)
    expect(bdCli.addComment).toBe(server.addCommentFn)
    expect(bdCli.updateStatus).toBe(server.updateBeadStatusFn)
    expect(bdCli.updateBead).toBe(server.updateBeadFn)
    expect(bdCli.createBead).toBe(server.createBeadFn)
    expect(bdCli.previewDelete).toBe(server.previewDeleteBeadFn)
    expect(bdCli.deleteBead).toBe(server.deleteBeadFn)
    expect(bdCli.enableEventsJournal).toBe(server.enableEventsJournalFn)
  })
})
