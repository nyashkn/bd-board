import { describe, expect, it } from 'vitest'

import {
  isHiddenByWindow,
  parseClosedWindow,
  windowCutoff,
} from './closed-window'
import { buildChildrenMap } from './tree'

import type { Bead } from './types'

const NOW = Date.parse('2026-06-30T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const b = (id: string, over: Partial<Bead> = {}): Bead => ({
  id,
  title: id,
  status: 'open',
  priority: 2,
  issue_type: 'task',
  ...over,
})
const hidden = (
  bead: Bead,
  all: Bead[],
  w: Parameters<typeof isHiddenByWindow>[2],
) => isHiddenByWindow(bead, buildChildrenMap(all), w, NOW)

describe('parseClosedWindow / cutoff', () => {
  it('accepts only known values', () => {
    expect(parseClosedWindow('30d')).toBe('30d')
    expect(parseClosedWindow('all')).toBe('all')
    expect(parseClosedWindow('2d')).toBeUndefined()
    expect(parseClosedWindow(undefined)).toBeUndefined()
  })
  it('computes cutoffs', () => {
    expect(windowCutoff('7d', NOW)).toBe(NOW - 7 * 86_400_000)
    expect(windowCutoff('all', NOW)).toBe(-Infinity)
  })
})

describe('isHiddenByWindow: closed beads', () => {
  it('hides closed beads older than the window, keeps recent ones', () => {
    const old = b('o', { status: 'closed', closed_at: daysAgo(8) })
    const recent = b('r', { status: 'closed', closed_at: daysAgo(6) })
    expect(hidden(old, [old], '7d')).toBe(true)
    expect(hidden(recent, [recent], '7d')).toBe(false)
    expect(hidden(old, [old], '30d')).toBe(false)
    expect(hidden(old, [old], 'all')).toBe(false)
  })
  it('window edge is inclusive of exactly N days', () => {
    const edge = b('e', { status: 'closed', closed_at: daysAgo(7) })
    expect(hidden(edge, [edge], '7d')).toBe(false)
  })
  it('falls back to updated_at, and shows beads with no timestamp', () => {
    const viaUpdated = b('u', { status: 'closed', updated_at: daysAgo(40) })
    const none = b('n', { status: 'closed' })
    expect(hidden(viaUpdated, [viaUpdated], '30d')).toBe(true)
    expect(hidden(none, [none], '1d')).toBe(false)
  })
  it('never hides unfinished beads', () => {
    const open = b('x', { closed_at: daysAgo(400) })
    expect(hidden(open, [open], '1d')).toBe(false)
  })
})

describe('isHiddenByWindow: epics', () => {
  const epic = b('e', { issue_type: 'epic' })
  it('completed epic follows its latest child closed_at', () => {
    const all = [
      epic,
      b('a', { parent: 'e', status: 'closed', closed_at: daysAgo(20) }),
      b('c', { parent: 'e', status: 'closed', closed_at: daysAgo(3) }),
    ]
    expect(hidden(epic, all, '7d')).toBe(false)
    const older = [
      epic,
      b('a', { parent: 'e', status: 'closed', closed_at: daysAgo(20) }),
      b('c', { parent: 'e', status: 'closed', closed_at: daysAgo(10) }),
    ]
    expect(hidden(epic, older, '7d')).toBe(true)
    expect(hidden(epic, older, '30d')).toBe(false)
  })
  it('epic with an open child is never hidden', () => {
    const all = [
      epic,
      b('a', { parent: 'e', status: 'closed', closed_at: daysAgo(90) }),
      b('c', { parent: 'e' }),
    ]
    expect(hidden(epic, all, '1d')).toBe(false)
  })
  it('closed epic with no children uses its own closed_at', () => {
    const e = b('e', {
      issue_type: 'epic',
      status: 'closed',
      closed_at: daysAgo(9),
    })
    expect(hidden(e, [e], '7d')).toBe(true)
  })
})
