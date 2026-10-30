import { describe, expect, it } from 'vitest'

import {
  compareHierarchy,
  expandableIds,
  filterWithAncestors,
  initials,
  readExpanded,
  rowState,
  shortId,
  splitClosed,
  writeExpanded,
} from './hierarchy'
import { beadMatches } from './sort'
import { buildChildrenMap } from './tree'

import type { Bead } from './types'

function bead(o: Partial<Bead>): Bead {
  return {
    id: 'x-1',
    title: 'T',
    status: 'open',
    priority: 2,
    issue_type: 'task',
    ...o,
  }
}

describe('compareHierarchy', () => {
  it('orders in progress, open, deferred, closed; then priority; then numeric id', () => {
    const items = [
      bead({ id: 'x-closed', status: 'closed', priority: 0 }),
      bead({ id: 'x-b.10', priority: 1 }),
      bead({ id: 'x-b.9', priority: 1 }),
      bead({ id: 'x-p3', priority: 3 }),
      bead({ id: 'x-def', status: 'deferred', priority: 0 }),
      bead({ id: 'x-wip', status: 'in_progress', priority: 4 }),
    ].sort(compareHierarchy)
    expect(items.map((b) => b.id)).toEqual([
      'x-wip',
      'x-b.9',
      'x-b.10',
      'x-p3',
      'x-def',
      'x-closed',
    ])
  })

  it('puts an epic ahead of a task of the same rank and priority', () => {
    const items = [
      bead({ id: 'x-1' }),
      bead({ id: 'x-2', issue_type: 'epic' }),
    ].sort(compareHierarchy)
    expect(items[0].id).toBe('x-2')
  })
})

describe('rowState', () => {
  it('names the state a row shows', () => {
    expect(rowState(bead({ status: 'closed' }))).toBe('closed')
    expect(rowState(bead({ status: 'deferred' }))).toBe('deferred')
    expect(rowState(bead({ status: 'blocked' }))).toBe('blocked')
    expect(rowState(bead({ status: 'in_progress' }))).toBe('in_progress')
    expect(rowState(bead({ waiting_on: ['x-9'] }))).toBe('waiting')
    expect(rowState(bead({}))).toBe('open')
  })
})

describe('row labels', () => {
  it('derives initials and short ids', () => {
    expect(initials('kn')).toBe('KN')
    expect(initials('jane.doe@example.com')).toBe('JD')
    expect(initials('Jane Doe')).toBe('JD')
    expect(initials(undefined)).toBe('')
    expect(shortId('demo-b6n.8')).toBe('b6n.8')
  })
})

describe('filterWithAncestors', () => {
  const beads = [
    bead({ id: 'e-1', issue_type: 'epic', title: 'Epic' }),
    bead({ id: 'e-1.1', parent: 'e-1', title: 'comms work' }),
    bead({ id: 'e-1.2', parent: 'e-1', title: 'other' }),
    bead({ id: 'e-2', issue_type: 'epic', title: 'Other epic' }),
    bead({ id: 'e-3', title: 'comms loose task' }),
  ]

  it('keeps matches with their ancestors and drops non-matching siblings', () => {
    const r = filterWithAncestors(beads, (b) =>
      beadMatches(b, 'comms', [], false, '', []),
    )
    expect(r.visible.map((b) => b.id)).toEqual(['e-1', 'e-1.1', 'e-3'])
    expect([...r.matched].sort()).toEqual(['e-1.1', 'e-3'])
    expect(r.epics).toBe(1)
  })

  it('survives a parent cycle', () => {
    const cyc = [bead({ id: 'a', parent: 'b' }), bead({ id: 'b', parent: 'a' })]
    expect(filterWithAncestors(cyc, () => true).visible).toHaveLength(2)
  })
})

describe('expand state', () => {
  function fakeStore(initial?: string) {
    const data = new Map<string, string>()
    if (initial !== undefined)
      data.set('bd-board:hierarchy-expanded:p', initial)
    return {
      data,
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    }
  }

  it('starts collapsed and round-trips per project', () => {
    const store = fakeStore()
    expect(readExpanded('p', store).size).toBe(0)
    writeExpanded('p', new Set(['a', 'b']), store)
    expect([...readExpanded('p', store)]).toEqual(['a', 'b'])
    expect(readExpanded('other', store).size).toBe(0)
  })

  it('treats corrupt or foreign values as empty', () => {
    expect(readExpanded('p', fakeStore('{not json')).size).toBe(0)
    expect([...readExpanded('p', fakeStore('["a",3,null]'))]).toEqual(['a'])
    expect(readExpanded('p', fakeStore('{"a":1}')).size).toBe(0)
  })

  it('does not throw when storage is missing or full', () => {
    expect(readExpanded('p', undefined).size).toBe(0)
    expect(() => writeExpanded('p', new Set(['a']), undefined)).not.toThrow()
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => writeExpanded('p', new Set(['a']), full)).not.toThrow()
  })

  it('expandableIds lists only beads with children', () => {
    const map = buildChildrenMap([
      bead({ id: 'a' }),
      bead({ id: 'b', parent: 'a' }),
    ])
    expect([...expandableIds(map)]).toEqual(['a'])
  })
})

describe('splitClosed', () => {
  it('puts open and in-progress work first and folds closed away', () => {
    const { active, closed } = splitClosed([
      bead({ id: 'x-1', status: 'closed' }),
      bead({ id: 'x-2', status: 'open' }),
      bead({ id: 'x-3', status: 'in_progress' }),
      bead({ id: 'x-10', status: 'closed' }),
      bead({ id: 'x-4', status: 'deferred' }),
    ])
    expect(active.map((b) => b.id)).toEqual(['x-3', 'x-2', 'x-4'])
    expect(closed.map((b) => b.id)).toEqual(['x-1', 'x-10'])
  })
})
