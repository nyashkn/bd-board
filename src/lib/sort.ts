import { groupBeadLinks, mapStatus } from './types'

import type { Bead } from './types'

export type SortKey = 'priority' | 'recent' | 'title'

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'recent', label: 'Most recent' },
  { key: 'title', label: 'Title' },
]

export const PRIORITIES = [0, 1, 2, 3, 4]

export const PRIORITY_TEXT_CLASS: Record<number, string> = {
  0: 'text-status-blocked',
  1: 'text-warn',
  2: 'text-muted-foreground',
  3: 'text-faint',
  4: 'text-faint',
}

export const PRIORITY_WORD: Record<number, string> = {
  0: 'Critical',
  1: 'High',
  2: 'Normal',
  3: 'Low',
  4: 'Backlog',
}

export function priorityLabel(p: number): string {
  return `P${Math.max(0, Math.min(4, p))}`
}

export function clampPriority(p: number): number {
  return Math.max(0, Math.min(4, Number.isFinite(p) ? p : 4))
}

function prio(b: Bead): number {
  return Number.isFinite(b.priority) ? b.priority : 9
}

function timeOf(b: Bead): number {
  const raw = b.updated_at ?? b.created_at
  if (!raw) return 0
  const t = Date.parse(raw)
  return Number.isNaN(t) ? 0 : t
}

export function compareBeads(sort: SortKey): (a: Bead, b: Bead) => number {
  return (a, b) => {
    if (sort === 'recent')
      return timeOf(b) - timeOf(a) || a.id.localeCompare(b.id)
    if (sort === 'title')
      return a.title.localeCompare(b.title) || prio(a) - prio(b)
    return prio(a) - prio(b) || a.id.localeCompare(b.id)
  }
}

/**
 * Ready = what `bd ready` lists (open, not deferred, no open blocker). Falls back to the old
 * approximation when bd did not say; that one counts a closed blocker as still blocking.
 */
export function isReady(bead: Bead): boolean {
  if (bead.ready !== undefined) return bead.ready
  return (
    mapStatus(bead.status).column === 'open' &&
    groupBeadLinks(bead.links).blockedBy.length === 0
  )
}

export function beadMatches(
  bead: Bead,
  search: string,
  priorities: number[],
  ready = false,
  assignee = '',
  labels: string[] = [],
): boolean {
  if (ready && !isReady(bead)) return false
  // Multi-select labels are OR: any one of them is enough.
  if (labels.length > 0 && !(bead.labels ?? []).some((l) => labels.includes(l)))
    return false
  if (assignee && bead.assignee !== assignee) return false
  if (
    priorities.length > 0 &&
    !priorities.includes(clampPriority(bead.priority))
  ) {
    return false
  }
  const q = search.trim().toLowerCase()
  if (
    q &&
    !(bead.id.toLowerCase().includes(q) || bead.title.toLowerCase().includes(q))
  ) {
    return false
  }
  return true
}

/** Labels present in the beads with how many beads carry each, most used first. */
export function labelCounts(beads: Bead[]): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const b of beads) {
    for (const label of new Set(b.labels ?? [])) {
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/** `l` URL param: comma separated, trimmed, deduplicated. */
export function parseLabelsParam(value?: string): string[] {
  if (!value) return []
  return Array.from(
    new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  )
}

export function serializeLabels(labels: string[]): string | undefined {
  return labels.length > 0 ? labels.join(',') : undefined
}

/**
 * Epic swimlane: a lane stays when any of its children matches, or, while a label
 * filter is active, when the epic itself matches (children may carry no label).
 */
export function keepEpicLane(
  epicMatches: boolean,
  labelsActive: boolean,
  matchedChildren: number,
  noChildren = false,
): boolean {
  // An epic scoped but not yet broken down has no children to match: keep it while it matches.
  return (
    matchedChildren > 0 ||
    (labelsActive && epicMatches) ||
    (noChildren && epicMatches)
  )
}

/**
 * Label chips for the toolbar: the `top` most used plus every selected one (pinned), the rest
 * go behind "more". `all` is already ordered by use.
 */
export function visibleLabels<T extends { label: string }>(
  all: T[],
  selected: string[],
  top = 8,
): { shown: T[]; hidden: T[] } {
  const shown = all.filter((l, i) => i < top || selected.includes(l.label))
  return { shown, hidden: all.filter((l) => !shown.includes(l)) }
}

/** Trigger text for the priority filter: "Priority" when off, else "P0–P1" or "P0, P2". */
export function priorityFilterLabel(priorities: number[]): string {
  if (priorities.length === 0) return 'Priority'
  const ps = [...priorities].sort((a, b) => a - b)
  const contiguous =
    ps.length > 1 && ps[ps.length - 1] - ps[0] === ps.length - 1
  return contiguous
    ? `P${ps[0]}–P${ps[ps.length - 1]}`
    : ps.map((p) => `P${p}`).join(', ')
}
