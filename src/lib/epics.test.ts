import { describe, expect, it } from 'vitest'

import { completedAt, descendantStats, isCompleteEpic } from './epics'
import { buildChildrenMap } from './tree'

import type { Bead } from './types'

const b = (id: string, over: Partial<Bead> = {}): Bead => ({
  id,
  title: id,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  ...over,
})

describe('descendantStats', () => {
  it('counts nested descendants once and skips container epics', () => {
    const beads = [
      b('e', { issue_type: 'epic' }),
      b('sub', { issue_type: 'epic', parent: 'e' }),
      b('a', { parent: 'e', status: 'closed' }),
      b('c', { parent: 'sub', status: 'in_progress' }),
      b('d', { parent: 'sub', status: 'blocked' }),
      b('x', { parent: 'c', status: 'open' }),
    ]
    const s = descendantStats('e', buildChildrenMap(beads))
    expect(s).toMatchObject({
      total: 4,
      closed: 1,
      in_progress: 1,
      blocked: 1,
      open: 1,
      percent: 25,
    })
  })

  it('survives a parent cycle without double counting', () => {
    const beads = [
      b('e', { issue_type: 'epic', parent: 'a' }),
      b('a', { parent: 'e' }),
    ]
    expect(descendantStats('e', buildChildrenMap(beads)).total).toBe(1)
  })

  it('is empty for a childless bead', () => {
    expect(descendantStats('z', new Map())).toMatchObject({
      total: 0,
      percent: 0,
    })
  })
})

describe('isCompleteEpic', () => {
  const epic = (over: Partial<Bead> = {}) =>
    b('e', { issue_type: 'epic', ...over })

  it('is complete when every child is closed', () => {
    const beads = [
      epic(),
      b('a', { parent: 'e', status: 'closed' }),
      b('c', { parent: 'e', status: 'closed' }),
    ]
    expect(isCompleteEpic(beads[0], buildChildrenMap(beads))).toBe(true)
  })

  it('is not complete with an open child, even if the epic is closed', () => {
    const beads = [
      epic({ status: 'closed' }),
      b('a', { parent: 'e', status: 'closed' }),
      b('c', { parent: 'e' }),
    ]
    expect(isCompleteEpic(beads[0], buildChildrenMap(beads))).toBe(false)
  })

  it('childless: complete only if itself closed', () => {
    expect(isCompleteEpic(epic(), new Map())).toBe(false)
    expect(isCompleteEpic(epic({ status: 'closed' }), new Map())).toBe(true)
  })

  it('never treats a non-epic as a completed epic', () => {
    expect(isCompleteEpic(b('t', { status: 'closed' }), new Map())).toBe(false)
  })
})

describe('completedAt', () => {
  it('takes the latest closed_at among self and descendants', () => {
    const beads = [
      b('e', { issue_type: 'epic', closed_at: '2026-01-02T00:00:00Z' }),
      b('a', { parent: 'e', closed_at: '2026-01-05T00:00:00Z' }),
      b('c', { parent: 'e', closed_at: '2026-01-03T00:00:00Z' }),
    ]
    expect(completedAt(beads[0], buildChildrenMap(beads))).toBe(
      Date.parse('2026-01-05T00:00:00Z'),
    )
  })

  it('is undefined when nothing has closed_at', () => {
    expect(completedAt(b('e'), new Map())).toBeUndefined()
  })
})
