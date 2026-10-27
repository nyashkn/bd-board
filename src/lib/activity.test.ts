import { describe, expect, it } from 'vitest'

import {
  baselineOnReturn,
  beadActivity,
  changeParts,
  diffSince,
  latestCommentByBead,
  readLastSeen,
  writeLastSeen,
} from './activity'

import type { Bead } from './types'

const bead = (id: string, o: Partial<Bead> = {}): Bead => ({
  id,
  title: id,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  ...o,
})

const SINCE = Date.parse('2026-10-20T00:00:00Z')

describe('comment-aware activity', () => {
  it('keeps the newest comment per bead', () => {
    const m = latestCommentByBead([
      { bead_id: 'a', created_at: '2026-10-21T00:00:00Z' },
      { bead_id: 'a', created_at: '2026-10-22T00:00:00Z' },
      { bead_id: 'b', created_at: undefined },
    ])
    expect(m.get('a')).toBe(Date.parse('2026-10-22T00:00:00Z'))
    expect(m.get('b')).toBeUndefined()
  })

  it('activity is the max of updated, closed and comment', () => {
    const b = bead('a', { updated_at: '2026-10-02T00:00:00Z' })
    expect(beadActivity(b)).toBe(Date.parse('2026-10-02T00:00:00Z'))
    expect(beadActivity(b, Date.parse('2026-10-09T00:00:00Z'))).toBe(
      Date.parse('2026-10-09T00:00:00Z'),
    )
    expect(beadActivity(bead('z', { updated_at: undefined }))).toBe(0)
  })
})

describe('diffSince', () => {
  const comments = new Map([
    ['c', Date.parse('2026-10-21T00:00:00Z')],
    ['old', Date.parse('2026-10-10T00:00:00Z')],
  ])
  const beads = [
    bead('n', { created_at: '2026-10-21T00:00:00Z' }),
    bead('x', { status: 'closed', closed_at: '2026-10-22T00:00:00Z' }),
    // created, edited and closed after SINCE: one entry, as closed
    bead('nx', {
      created_at: '2026-10-21T00:00:00Z',
      status: 'closed',
      closed_at: '2026-10-22T00:00:00Z',
    }),
    bead('c'),
    bead('old'),
    bead('u', { updated_at: '2026-10-23T00:00:00Z' }),
    bead('quiet'),
  ]

  it('assigns one kind per bead and counts them', () => {
    const d = diffSince(beads, SINCE, comments)
    expect(d.byBead.get('n')).toBe('new')
    expect(d.byBead.get('x')).toBe('closed')
    expect(d.byBead.get('nx')).toBe('closed')
    expect(d.byBead.get('c')).toBe('commented')
    expect(d.byBead.get('u')).toBe('updated')
    expect(d.byBead.has('old')).toBe(false)
    expect(d.byBead.has('quiet')).toBe(false)
    expect(d.counts).toEqual({ closed: 2, new: 1, commented: 1, updated: 1 })
    expect(d.total).toBe(5)
  })

  it('lists only non-empty parts', () => {
    expect(
      changeParts({ closed: 2, new: 0, commented: 9, updated: 0 }),
    ).toEqual([
      { kind: 'commented', count: 9 },
      { kind: 'closed', count: 2 },
    ])
  })
})

describe('last-seen storage', () => {
  const mem = () => {
    const d = new Map<string, string>()
    return {
      getItem: (k: string) => d.get(k) ?? null,
      setItem: (k: string, v: string) => void d.set(k, v),
    }
  }
  it('round-trips per project and tolerates garbage and a missing store', () => {
    const s = mem()
    expect(readLastSeen('p', s)).toBeNull()
    writeLastSeen('p', 123, s)
    expect(readLastSeen('p', s)).toBe(123)
    expect(readLastSeen('q', s)).toBeNull()
    s.setItem('bd-board:last-seen:p', 'nope')
    expect(readLastSeen('p', s)).toBeNull()
    expect(() => writeLastSeen('p', 1, undefined)).not.toThrow()
    const boom = {
      getItem: () => {
        throw new Error('x')
      },
      setItem: () => {
        throw new Error('x')
      },
    }
    expect(readLastSeen('p', boom)).toBeNull()
    expect(() => writeLastSeen('p', 1, boom)).not.toThrow()
  })

  it('only a long absence moves the baseline', () => {
    expect(baselineOnReturn(5, 1000, 1000 + 10_000)).toBe(5)
    expect(baselineOnReturn(5, 1000, 1000 + 60_000)).toBe(1000)
    expect(baselineOnReturn(null, 1000, 1000 + 3_600_000)).toBe(1000)
  })
})
