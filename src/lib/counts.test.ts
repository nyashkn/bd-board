import { describe, expect, it } from 'vitest'

import { assignedCounts, summarizeBeads } from './counts'
import { explainEmpty } from './empty-reason'
import { beadMatches } from './sort'

import type { Bead } from './types'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const b = (id: string, over: Partial<Bead> = {}): Bead => ({
  id,
  title: id,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  ...over,
})

// Mirrors the ops copy: closed beads dominate, one assignee owns only old closed work,
// a blocked bead waits on an open dependency, a closed one does not count as blocked.
const fixture: Bead[] = [
  b('o1', { ready: true }),
  b('o2', { ready: true }),
  b('d1', { status: 'deferred', ready: false }),
  b('p1', { status: 'in_progress', ready: false }),
  b('w1', { waiting_on: ['o1'], ready: false }),
  b('w2', { status: 'in_progress', waiting_on: ['o1'], ready: false }),
  b('x1', { status: 'blocked', ready: false }),
  b('c1', { status: 'closed', assignee: 'KN', closed_at: daysAgo(20) }),
  b('c2', { status: 'closed', assignee: 'KN', closed_at: daysAgo(40) }),
  b('c3', { status: 'closed', waiting_on: ['o1'], closed_at: daysAgo(1) }),
]

describe('summarizeBeads', () => {
  const c = summarizeBeads(fixture)
  it('total counts every listed bead, active excludes closed', () => {
    expect(c.total).toBe(10)
    expect(c.active).toBe(7)
    expect(c.closed).toBe(3)
  })
  it('column counts add up to total (no bead counted twice)', () => {
    expect(c.open + c.deferred + c.in_progress + c.blocked + c.closed).toBe(
      c.total,
    )
  })
  it('blocked = waiting on open dependency or status blocked, never closed', () => {
    expect(c.blocked).toBe(3)
  })
  it('ready follows bd ready', () => {
    expect(c.ready).toBe(2)
  })
})

describe('assignedCounts', () => {
  it('splits open from closed so a closed-only assignee reads 0 open', () => {
    expect(assignedCounts(fixture, 'KN')).toEqual({
      active: 0,
      closed: 2,
      total: 2,
    })
  })
})

describe('explainEmpty', () => {
  const mine = (x: Bead) => beadMatches(x, '', [], false, 'KN', [])
  it('is none when something is visible', () => {
    expect(explainEmpty(fixture, () => true, '7d', NOW).kind).toBe('none')
  })
  it('explains Assigned to me hidden by the closed window with fixes', () => {
    const r = explainEmpty(fixture, mine, '7d', NOW)
    expect(r).toEqual({
      kind: 'closed-hidden',
      hidden: 2,
      options: [
        { window: '30d', shown: 1 },
        { window: '90d', shown: 2 },
      ],
    })
  })
  it('reports no-match when nothing matches regardless of window', () => {
    expect(explainEmpty(fixture, (x) => x.id === 'nope', 'all', NOW).kind).toBe(
      'no-match',
    )
  })
})
