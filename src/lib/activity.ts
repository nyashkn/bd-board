import type { Bead, ProjectComment } from './types'

/**
 * "Since you last looked": what changed in a project after a timestamp. A comment does not
 * bump a bead's `updated_at`, so activity is max(updated_at, closed_at, latest comment).
 */

export type ChangeKind = 'closed' | 'new' | 'commented' | 'updated'

export const CHANGE_LABEL: Record<ChangeKind, string> = {
  closed: 'closed',
  new: 'new',
  commented: 'commented',
  updated: 'updated',
}

const KINDS: ChangeKind[] = ['commented', 'closed', 'new', 'updated']

function ms(iso: string | undefined): number {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : 0
}

/** Newest comment time (ms) per bead id. */
export function latestCommentByBead(
  comments: Pick<ProjectComment, 'bead_id' | 'created_at'>[],
): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of comments) {
    const t = ms(c.created_at)
    if (t > (map.get(c.bead_id) ?? 0)) map.set(c.bead_id, t)
  }
  return map
}

/** Last activity (ms) of a bead, comments included; 0 when nothing is dated. */
export function beadActivity(bead: Bead, latestComment = 0): number {
  return Math.max(ms(bead.updated_at), ms(bead.closed_at), latestComment)
}

export interface ChangeSet {
  byBead: Map<string, ChangeKind>
  counts: Record<ChangeKind, number>
  total: number
}

/**
 * One kind per bead, strongest first: closed, new, commented (a comment after `since`), then
 * updated (other edits). A bead that was created, edited and closed after `since` counts once, as closed.
 */
export function diffSince(
  beads: Bead[],
  since: number,
  latestComment: Map<string, number>,
): ChangeSet {
  const byBead = new Map<string, ChangeKind>()
  const counts: Record<ChangeKind, number> = {
    closed: 0,
    new: 0,
    commented: 0,
    updated: 0,
  }
  for (const b of beads) {
    let kind: ChangeKind | null = null
    if (b.status === 'closed' && ms(b.closed_at || b.updated_at) > since)
      kind = 'closed'
    else if (ms(b.created_at) > since) kind = 'new'
    else if ((latestComment.get(b.id) ?? 0) > since) kind = 'commented'
    else if (ms(b.updated_at) > since) kind = 'updated'
    if (kind) {
      byBead.set(b.id, kind)
      counts[kind]++
    }
  }
  return { byBead, counts, total: byBead.size }
}

/** Display order of the band parts. */
export function changeParts(
  counts: ChangeSet['counts'],
): { kind: ChangeKind; count: number }[] {
  return KINDS.map((kind) => ({ kind, count: counts[kind] })).filter(
    (p) => p.count > 0,
  )
}

// --- last-seen storage -------------------------------------------------------------------

const SEEN_KEY = 'bd-board:last-seen:'

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function defaultStore(): KeyValueStore | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** Last time the user looked at a project (ms), or null on a first visit / unreadable storage. */
export function readLastSeen(
  project: string,
  store: KeyValueStore | undefined = defaultStore(),
): number | null {
  try {
    const n = Number(store?.getItem(SEEN_KEY + project))
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function writeLastSeen(
  project: string,
  at: number,
  store: KeyValueStore | undefined = defaultStore(),
): void {
  try {
    store?.setItem(SEEN_KEY + project, String(at))
  } catch {
    // storage unavailable: the band just does not show next time
  }
}

/** A tab hidden for less than this is a glance away, not "coming back". */
export const MIN_AWAY_MS = 60_000

/**
 * The baseline for the band when the tab becomes visible again: the time it was hidden if the
 * user was away long enough, otherwise the baseline they already had.
 */
export function baselineOnReturn(
  current: number | null,
  hiddenAt: number,
  now: number,
): number | null {
  return now - hiddenAt >= MIN_AWAY_MS ? hiddenAt : current
}
