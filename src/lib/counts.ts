import { isReady } from './sort'
import { beadColumn } from './types'

import type { Bead, ProjectCounts } from './types'

export interface BeadCounts extends ProjectCounts {
  /** What `bd ready` lists. */
  ready: number
  /** total minus closed: the live work. */
  active: number
}

/**
 * The one place bead totals are derived. Every surface (dashboard, rail, board
 * headers) reads these from the same listed beads, so a word carries one number:
 *  - total:   every bead the board can open, closed included
 *  - active:  total minus closed
 *  - blocked: waiting on an open dependency (`bd blocked`) or status blocked, never closed
 *  - ready:   what `bd ready` lists
 * `bd count` is not used: it also counts beads `bd list` hides, so it never matches the board.
 */
export function summarizeBeads(beads: Bead[]): BeadCounts {
  const c: BeadCounts = {
    open: 0,
    in_progress: 0,
    blocked: 0,
    closed: 0,
    deferred: 0,
    total: beads.length,
    ready: 0,
    active: 0,
  }
  for (const b of beads) {
    const column = beadColumn(b)
    if (b.status === 'deferred' && column === 'open') c.deferred++
    else c[column]++
    if (column !== 'closed') c.active++
    if (isReady(b)) c.ready++
  }
  return c
}

/** Beads assigned to `who`, split so "mine" never passes closed work off as live. */
export function assignedCounts(beads: Bead[], who: string) {
  let active = 0
  let closed = 0
  for (const b of beads) {
    if (b.assignee !== who) continue
    if (beadColumn(b) === 'closed') closed++
    else active++
  }
  return { active, closed, total: active + closed }
}
