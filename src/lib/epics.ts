import { formatDuration } from './age'
import { isEpic, mapStatus } from './types'

import type { Bead, BeadColumn } from './types'

export interface DescendantStats {
  total: number
  open: number
  in_progress: number
  blocked: number
  closed: number
  /** 0-100, rounded; 0 when there is nothing to count. */
  percent: number
}

/**
 * Counts every descendant of `id` exactly once (a visited set guards against
 * diamonds and cycles). Epics that have children are containers and are not
 * counted themselves; their leaves are. Empty sub-epics count as one item.
 */
export function descendantStats(
  id: string,
  childrenMap: Map<string, Bead[]>,
): DescendantStats {
  const stats: DescendantStats = {
    total: 0,
    open: 0,
    in_progress: 0,
    blocked: 0,
    closed: 0,
    percent: 0,
  }
  const seen = new Set<string>([id])
  const stack = [...(childrenMap.get(id) ?? [])]
  while (stack.length > 0) {
    const bead = stack.pop() as Bead
    if (seen.has(bead.id)) continue
    seen.add(bead.id)
    const kids = childrenMap.get(bead.id) ?? []
    if (isEpic(bead) && kids.length > 0) {
      stack.push(...kids)
      continue
    }
    const column: BeadColumn = mapStatus(bead.status).column
    stats[column] += 1
    stats.total += 1
    // Non-epic parents (nested subtasks) still contribute their own children.
    stack.push(...kids)
  }
  stats.percent =
    stats.total === 0 ? 0 : Math.round((stats.closed / stats.total) * 100)
  return stats
}

const isClosed = (b: Bead) => mapStatus(b.status).column === 'closed'

/**
 * Complete: has descendants and all are closed, or has none and is itself
 * closed. A closed bead that still has unfinished descendants is NOT complete,
 * so hiding it can never hide open work.
 */
export function isComplete(
  bead: Bead,
  childrenMap: Map<string, Bead[]>,
): boolean {
  const s = descendantStats(bead.id, childrenMap)
  return s.total === 0 ? isClosed(bead) : s.closed === s.total
}

/** Completed epic: an epic that is complete. */
export function isCompleteEpic(
  bead: Bead,
  childrenMap: Map<string, Bead[]>,
): boolean {
  return isEpic(bead) && isComplete(bead, childrenMap)
}

/**
 * Epoch ms of the epic's completion: the latest closed_at among itself and all
 * descendants. undefined when nothing carries a valid closed_at.
 */
export function completedAt(
  bead: Bead,
  childrenMap: Map<string, Bead[]>,
): number | undefined {
  let latest: number | undefined
  const seen = new Set<string>()
  const stack = [bead]
  while (stack.length > 0) {
    const b = stack.pop() as Bead
    if (seen.has(b.id)) continue
    seen.add(b.id)
    const t = b.closed_at ? Date.parse(b.closed_at) : Number.NaN
    if (!Number.isNaN(t) && (latest === undefined || t > latest)) latest = t
    stack.push(...(childrenMap.get(b.id) ?? []))
  }
  return latest
}

/** "5d" for a completed epic: created_at to its completion; "" when unknown. */
export function epicTook(
  bead: Bead,
  childrenMap: Map<string, Bead[]>,
): string {
  return formatDuration(bead.created_at, completedAt(bead, childrenMap))
}
