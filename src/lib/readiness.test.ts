import { describe, expect, it } from 'vitest'

import fixture from './fixtures/bd-readiness.json'
import { applyBlockedToCounts, applyReadiness, buildBeadGraph } from './bd'
import { descendantStats } from './epics'
import { isReady } from './sort'
import { buildChildrenMap } from './tree'
import { beadColumn } from './types'

import type { Bead } from './types'

// Trimmed real `bd list --all` / `bd blocked` / `bd ready` output (ids and edges only).
const list = fixture.list as Record<string, unknown>[]
const blocked = fixture.blocked as Record<string, unknown>[]
const ready = fixture.ready as Record<string, unknown>[]

describe('readiness from bd blocked / bd ready', () => {
  const beads = buildBeadGraph(list, { blocked, ready })

  it('puts exactly the beads `bd blocked` lists into the Blocked column', () => {
    const inBlocked = beads.filter((b) => beadColumn(b) === 'blocked')
    expect(inBlocked.map((b) => b.id).sort()).toEqual(
      blocked.map((r) => r.id as string).sort(),
    )
    expect(inBlocked).toHaveLength(fixture.blockedTotal)
  })

  it('keeps a waiting in-progress or deferred bead in Blocked, not its status column', () => {
    const waitingInProgress = beads.find(
      (b) => b.status === 'in_progress' && b.waiting_on?.length,
    )
    expect(waitingInProgress).toBeDefined()
    expect(beadColumn(waitingInProgress as Bead)).toBe('blocked')
  })

  it('agrees with `bd ready`, including beads whose only blockers are closed', () => {
    const readyIds = new Set(ready.map((r) => r.id))
    for (const b of beads) expect(isReady(b)).toBe(readyIds.has(b.id))
    // The old link-only rule called these not ready: every blocker is closed.
    const closedBlocker = beads.find(
      (b) =>
        b.status === 'open' &&
        (b.links ?? []).some((l) => l.type === 'blocks') &&
        !b.waiting_on?.length,
    )
    expect(closedBlocker).toBeDefined()
    expect(isReady(closedBlocker as Bead)).toBe(true)
    const legacy = buildBeadGraph(list).find((b) => b.id === closedBlocker?.id)
    expect(isReady(legacy as Bead)).toBe(false)
  })

  it('never reports a deferred bead as ready', () => {
    for (const b of beads.filter((x) => x.status === 'deferred'))
      expect(isReady(b)).toBe(false)
  })

  it('counts waiting leaves as blocked in epic stats', () => {
    const tree: Bead[] = [
      { id: 'e', title: 'e', status: 'open', priority: 1, issue_type: 'epic' },
      { id: 'e.1', parent: 'e', status: 'open', waiting_on: ['e.2'] },
      { id: 'e.2', parent: 'e', status: 'open' },
      { id: 'e.3', parent: 'e', status: 'in_progress', waiting_on: ['e.2'] },
    ].map((b) => ({ title: b.id, priority: 1, issue_type: 'task', ...b }))
    const stats = descendantStats('e', buildChildrenMap(tree))
    expect([stats.open, stats.in_progress, stats.blocked]).toEqual([1, 0, 2])
  })

  it('stamps nothing when bd gave no list, so status-only rules apply', () => {
    const plain = buildBeadGraph(list)
    expect(plain.every((b) => b.waiting_on === undefined)).toBe(true)
    expect(plain.every((b) => b.ready === undefined)).toBe(true)
    expect(applyReadiness(plain)).toBe(plain)
    expect(plain.filter((b) => beadColumn(b) === 'blocked').length).toBe(
      plain.filter((b) => b.status === 'blocked').length,
    )
  })

  it('ignores blocked rows with no blockers', () => {
    const out = applyReadiness(
      [{ id: 'a', status: 'open' } as Bead],
      [{ id: 'a', blocked_by: [] }],
    )
    expect(out[0].waiting_on).toEqual([])
  })
})

describe('applyBlockedToCounts', () => {
  const base = {
    open: 144,
    in_progress: 7,
    blocked: 0,
    closed: 274,
    deferred: 5,
    total: 430,
  }

  it('moves each waiting bead out of its status bucket, total unchanged', () => {
    const rows = [
      ...Array.from({ length: 16 }, () => ({ status: 'open' })),
      { status: 'in_progress' },
      { status: 'in_progress' },
      { status: 'deferred' },
    ]
    expect(applyBlockedToCounts(base, rows)).toEqual({
      open: 128,
      in_progress: 5,
      blocked: 19,
      closed: 274,
      deferred: 4,
      total: 430,
    })
  })

  it('does not count a status=blocked bead twice', () => {
    const counts = { ...base, blocked: 2, open: 142, total: 430 }
    const out = applyBlockedToCounts(counts, [{ status: 'blocked' }])
    expect(out.blocked).toBe(2)
    expect(out.open).toBe(142)
  })
})
