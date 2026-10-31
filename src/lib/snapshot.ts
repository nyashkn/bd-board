import { parseKnowledgeCommentText } from './knowledge.ts'

import type {
  Bead,
  BeadDetail,
  BeadLink,
  Comment,
  ProjectComment,
  ProjectKnowledge,
  ProjectKnowledgeEntry,
  RelatedBead,
} from './types.ts'

/**
 * Pure: the wire shape of `snapshot` and the selectors over it. Safe to import from the client
 * and the server. The backends (bd.ts, the Rust adapter) build the snapshot; the UI reads it
 * through these selectors and never calls `bd show` to open a bead.
 */

/** Bump when the ProjectSnapshot shape changes: persisted snapshots from older builds are discarded. */
export const SNAPSHOT_SCHEMA_VERSION = '1'

export const COMMENTS_LIMIT = 250
export const KNOWLEDGE_LIMIT = 500

/** One dependency edge as `bd export` reports it: `from` depends on `to`. */
export interface SnapshotEdge {
  from: string
  to: string
  type: string
}

/** A bead as exported: plain fields plus its comments and outgoing edges. */
export interface SnapshotBead extends Omit<
  Bead,
  'links' | 'children' | 'childBeads' | 'waiting_on' | 'ready'
> {
  comments: Comment[]
  edges: SnapshotEdge[]
}

export interface BlockedRow {
  id: string
  blocked_by: string[]
}

export interface ProjectSnapshot {
  beads: SnapshotBead[]
  /** Ids from `bd ready`; null when bd could not say (old bd, failed call). */
  ready: string[] | null
  /** Rows from `bd blocked`; null when bd could not say. */
  blocked: BlockedRow[] | null
  /**
   * Content hash of the three bd outputs (the feed seq would cost another bd call); the SQL reader
   * sends the Dolt head hash. In memory only: never persisted, and comparable only within one
   * backend and session.
   */
  cursor: string
  /** The SQL reader had no bd to ask, so ready and blocked are empty on purpose. */
  readiness_unavailable?: boolean
}

/** What `bd list` hides by default and `bd export` does not (gates), plus infra types. */
const UNLISTED_TYPES = new Set(['gate', 'agent', 'role', 'message'])

export const isListed = (bead: { issue_type: string }): boolean =>
  !UNLISTED_TYPES.has(bead.issue_type)

// Derived fields are rebuilt per selector; the Rust side sends nulls for the empty ones.
const NOT_PLAIN = [
  'comments',
  'edges',
  'children',
  'childBeads',
  'links',
  'waiting_on',
  'ready',
] as const

function toBead(source: SnapshotBead): Bead {
  const bead: Record<string, unknown> = { ...source }
  for (const key of NOT_PLAIN) delete bead[key]
  return bead as unknown as Bead
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

export function deriveChildren(beads: Bead[]): Bead[] {
  const childMap = new Map<string, string[]>()
  for (const b of beads) if (b.parent) push(childMap, b.parent, b.id)
  const beadById = new Map(beads.map((b) => [b.id, b]))
  return beads.map((b) => {
    const childIds = childMap.get(b.id)
    if (!childIds?.length) return b
    return {
      ...b,
      children: childIds,
      childBeads: childIds
        .map((id) => beadById.get(id))
        .filter((x): x is Bead => x !== undefined),
    }
  })
}

/** The board's bead list: what `bd list --all --json` plus links, readiness and children gave. */
export function selectBoard(snapshot: ProjectSnapshot): Bead[] {
  return memo(boards, snapshot, buildBoard)
}

// Selectors run once per snapshot object, however many observers ask.
const boards = new WeakMap<ProjectSnapshot, Bead[]>()
const knowledgeCache = new WeakMap<ProjectSnapshot, ProjectKnowledge>()

function memo<T>(
  cache: WeakMap<ProjectSnapshot, T>,
  snapshot: ProjectSnapshot,
  build: (s: ProjectSnapshot) => T,
): T {
  let value = cache.get(snapshot)
  if (value === undefined) cache.set(snapshot, (value = build(snapshot)))
  return value
}

function buildBoard(snapshot: ProjectSnapshot): Bead[] {
  const listed = snapshot.beads.filter(isListed)
  const known = new Set(listed.map((b) => b.id))
  const links = new Map<string, BeadLink[]>()
  const parents = new Map<string, string>()
  const seen = new Set<string>()
  for (const bead of listed) {
    for (const e of bead.edges) {
      const key = `${e.from}|${e.to}|${e.type}`
      if (!known.has(e.from) || !known.has(e.to) || seen.has(key)) continue
      seen.add(key)
      push(links, e.from, { id: e.to, type: e.type, direction: 'outgoing' })
      push(links, e.to, { id: e.from, type: e.type, direction: 'incoming' })
      if (e.type === 'parent-child') parents.set(e.from, e.to)
    }
  }
  const waiting = new Map(
    snapshot.blocked
      ?.filter((r) => r.blocked_by.length > 0)
      .map((r) => [r.id, r.blocked_by]),
  )
  const ready = snapshot.ready ? new Set(snapshot.ready) : undefined
  return deriveChildren(
    listed.map((source) => {
      const bead = toBead(source)
      const parent = bead.parent ?? parents.get(bead.id)
      const own = links.get(bead.id)
      return {
        ...bead,
        ...(parent ? { parent } : {}),
        ...(own ? { links: own } : {}),
        ...(snapshot.blocked ? { waiting_on: waiting.get(bead.id) ?? [] } : {}),
        ...(ready ? { ready: ready.has(bead.id) } : {}),
      }
    }),
  )
}

/**
 * What `bd show <id> --json` plus `bd comments` gave, without either: edge targets joined by id
 * (any bead in the snapshot, gates included), comments as exported.
 */
export function selectDetail(
  snapshot: ProjectSnapshot,
  id: string,
): BeadDetail | undefined {
  const source = snapshot.beads.find((b) => b.id === id)
  if (!source) return undefined
  const byId = new Map(snapshot.beads.map((b) => [b.id, b]))
  const dependencies: RelatedBead[] = source.edges
    .filter((e) => e.from === id && byId.has(e.to))
    .map((e) => {
      const target = byId.get(e.to)!
      return {
        id: target.id,
        title: target.title,
        status: target.status,
        issue_type: target.issue_type,
        dependency_type: e.type,
      }
    })
  let dependents = 0
  for (const b of snapshot.beads)
    for (const e of b.edges) if (e.to === id) dependents++
  const bead = toBead(source)
  const parent =
    bead.parent ??
    source.edges.find((e) => e.from === id && e.type === 'parent-child')?.to
  return {
    ...bead,
    ...(parent ? { parent } : {}),
    // bd show counts every edge, parent-child included; export's own counts leave those out.
    dependency_count: dependencies.length,
    dependent_count: dependents,
    dependencies,
    comments: source.comments,
  }
}

const byDateDesc = (a: { created_at?: string }, b: { created_at?: string }) =>
  (b.created_at ?? '').localeCompare(a.created_at ?? '')

/** What the project-knowledge `bd export` query gave: recent comments and the typed entries. */
export function selectKnowledge(snapshot: ProjectSnapshot): ProjectKnowledge {
  return memo(knowledgeCache, snapshot, buildKnowledge)
}

function buildKnowledge(snapshot: ProjectSnapshot): ProjectKnowledge {
  const all: ProjectComment[] = snapshot.beads.flatMap((b) =>
    b.comments.map((c) => ({
      id: c.id,
      bead_id: b.id,
      bead_title: b.title || undefined,
      author: c.author,
      text: c.text,
      created_at: c.created_at,
      knowledge_type: parseKnowledgeCommentText(c.text)?.type,
    })),
  )
  const knowledge = all
    .flatMap((c): ProjectKnowledgeEntry[] => {
      const parsed = parseKnowledgeCommentText(c.text)
      return parsed
        ? [{ ...c, type: parsed.type, content: parsed.content }]
        : []
    })
    .sort(byDateDesc)
    .slice(0, KNOWLEDGE_LIMIT)
  return {
    comments: all.sort(byDateDesc).slice(0, COMMENTS_LIMIT),
    knowledge,
  }
}

// Patches: pure, applied to the cached snapshot by writes and the comments refresh.

export function patchBead(
  snapshot: ProjectSnapshot,
  id: string,
  fields: Partial<SnapshotBead>,
): ProjectSnapshot {
  return {
    ...snapshot,
    beads: snapshot.beads.map((b) => (b.id === id ? { ...b, ...fields } : b)),
  }
}

export function setComments(
  snapshot: ProjectSnapshot,
  id: string,
  comments: Comment[],
): ProjectSnapshot {
  return patchBead(snapshot, id, {
    comments,
    comment_count: comments.length,
  })
}

export function addComment(
  snapshot: ProjectSnapshot,
  id: string,
  comment: Comment,
): ProjectSnapshot {
  const bead = snapshot.beads.find((b) => b.id === id)
  return bead
    ? setComments(snapshot, id, [...bead.comments, comment])
    : snapshot
}

export function insertBead(
  snapshot: ProjectSnapshot,
  bead: SnapshotBead,
): ProjectSnapshot {
  return snapshot.beads.some((b) => b.id === bead.id)
    ? snapshot
    : { ...snapshot, beads: [...snapshot.beads, bead] }
}

/** Removes a bead and its descendants (`bd delete --cascade`). */
export function removeBead(
  snapshot: ProjectSnapshot,
  id: string,
): ProjectSnapshot {
  const gone = new Set([id])
  for (let grew = true; grew; ) {
    grew = false
    for (const b of snapshot.beads) {
      const parent =
        b.parent ?? b.edges.find((e) => e.type === 'parent-child')?.to
      if (parent && gone.has(parent) && !gone.has(b.id)) {
        gone.add(b.id)
        grew = true
      }
    }
  }
  return {
    ...snapshot,
    beads: snapshot.beads.filter((b) => !gone.has(b.id)),
  }
}
