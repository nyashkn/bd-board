import { beadColumn, isEpic } from './types'

import type { Bead } from './types'

/** What a Hierarchy row says about a bead's state (one glyph, one word). */
export type RowState =
  | 'open'
  | 'in_progress'
  | 'waiting'
  | 'blocked'
  | 'deferred'
  | 'closed'

export function rowState(b: Bead): RowState {
  if (b.status === 'closed') return 'closed'
  if (b.status === 'deferred') return 'deferred'
  if (b.status === 'blocked') return 'blocked'
  if (b.waiting_on?.length) return 'waiting'
  return beadColumn(b) === 'in_progress' ? 'in_progress' : 'open'
}

export const ROW_STATE_LABEL: Record<RowState, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting: 'Waiting',
  blocked: 'Blocked',
  deferred: 'Deferred',
  closed: 'Closed',
}

/** Sort rank: moving work first, then the rest of the open work, deferred, closed last. */
function rank(b: Bead): number {
  if (b.status === 'closed') return 3
  if (b.status === 'deferred') return 2
  return b.status === 'in_progress' || b.status === 'hooked' ? 0 : 1
}

/**
 * Hierarchy order: in progress, other open work (waiting included), deferred, closed; then
 * priority; then id with numbers compared as numbers (`.9` before `.10`). Epics sort ahead
 * of plain tasks within the same rank and priority.
 */
export function compareHierarchy(a: Bead, b: Bead): number {
  return (
    rank(a) - rank(b) ||
    (Number.isFinite(a.priority) ? a.priority : 9) -
      (Number.isFinite(b.priority) ? b.priority : 9) ||
    Number(isEpic(b)) - Number(isEpic(a)) ||
    a.id.localeCompare(b.id, undefined, { numeric: true })
  )
}

/** "KN" from "kn", "jane.doe@example.com" or "Jane Doe"; empty when unassigned. */
export function initials(assignee?: string): string {
  const name = (assignee ?? '').split('@')[0].trim()
  if (!name) return ''
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  const letters =
    parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return letters.toUpperCase()
}

/** "b6n.8" for "demo-b6n.8": the project prefix adds nothing inside one project. */
export function shortId(id: string): string {
  return id.replace(/^[^-]+-/, '')
}

export interface TreeFilterResult {
  /** Matching beads plus their ancestors. */
  visible: Bead[]
  matched: Set<string>
  /** Distinct nearest epics holding the matches (a match under no epic adds none). */
  epics: number
}

/**
 * Keeps every bead the predicate accepts together with its ancestor path, so a match is
 * never orphaned. Cycles in `parent` are guarded by a visited set.
 */
export function filterWithAncestors(
  beads: Bead[],
  matches: (b: Bead) => boolean,
): TreeFilterResult {
  const byId = new Map(beads.map((b) => [b.id, b]))
  const matched = new Set<string>()
  const keep = new Set<string>()
  const epicIds = new Set<string>()
  for (const b of beads) {
    if (!matches(b)) continue
    matched.add(b.id)
    let epicFound = false
    const seen = new Set<string>()
    for (
      let cur: Bead | undefined = b;
      cur && !seen.has(cur.id);
      cur = cur.parent ? byId.get(cur.parent) : undefined
    ) {
      seen.add(cur.id)
      keep.add(cur.id)
      if (!epicFound && cur.id !== b.id && isEpic(cur)) {
        epicIds.add(cur.id)
        epicFound = true
      }
    }
  }
  return {
    visible: beads.filter((b) => keep.has(b.id)),
    matched,
    epics: epicIds.size,
  }
}

/** Ids of every bead that has at least one child in `childrenMap`. */
export function expandableIds(childrenMap: Map<string, Bead[]>): Set<string> {
  return new Set(
    [...childrenMap].filter(([, kids]) => kids.length > 0).map(([id]) => id),
  )
}

const EXPANDED_KEY = 'bd-board:hierarchy-expanded:'

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function defaultStore(): KeyValueStore | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** Expanded ids saved for a project; an empty set (all collapsed) when none or unreadable. */
export function readExpanded(
  project: string,
  store: KeyValueStore | undefined = defaultStore(),
): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      store?.getItem(EXPANDED_KEY + project) ?? '[]',
    )
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((x): x is string => typeof x === 'string')
        : [],
    )
  } catch {
    return new Set()
  }
}

export function writeExpanded(
  project: string,
  expanded: Set<string>,
  store: KeyValueStore | undefined = defaultStore(),
): void {
  try {
    store?.setItem(EXPANDED_KEY + project, JSON.stringify([...expanded]))
  } catch {
    // storage unavailable (private mode, quota): the tree just starts collapsed next time
  }
}

/** Active work first (in progress, open, deferred), closed beads split off to fold away. */
export function splitClosed(beads: Bead[]): { active: Bead[]; closed: Bead[] } {
  const sorted = [...beads].sort(compareHierarchy)
  return {
    active: sorted.filter((b) => b.status !== 'closed'),
    closed: sorted.filter((b) => b.status === 'closed'),
  }
}
