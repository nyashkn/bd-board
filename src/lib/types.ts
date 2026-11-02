export type BeadColumn = 'open' | 'in_progress' | 'blocked' | 'closed'

export type RawStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'deferred'
  | 'closed'
  | 'pinned'
  | 'hooked'
  | (string & {})

export interface Comment {
  id: string
  author?: string
  text: string
  created_at?: string
}

export type KnowledgeType =
  | 'learned'
  | 'decision'
  | 'fact'
  | 'pattern'
  | 'investigation'
  | 'must-check'
  | 'deviation'

export interface ProjectComment extends Comment {
  bead_id: string
  bead_title?: string
  knowledge_type?: KnowledgeType
}

export interface ProjectKnowledgeEntry extends ProjectComment {
  type: KnowledgeType
  content: string
}

export interface ProjectKnowledge {
  comments: ProjectComment[]
  knowledge: ProjectKnowledgeEntry[]
}

export type LinkDirection = 'outgoing' | 'incoming'

/**
 * One dependency edge as seen from a single bead. `outgoing` means this bead is
 * the `issue_id` of the bd edge, `incoming` means it is the `depends_on_id`.
 */
export interface BeadLink {
  id: string
  type: string
  direction: LinkDirection
}

export interface Bead {
  id: string
  title: string
  description?: string
  acceptance_criteria?: string
  design?: string
  notes?: string
  status: RawStatus
  priority: number
  issue_type: string
  assignee?: string
  owner?: string
  created_at?: string
  updated_at?: string
  closed_at?: string
  labels?: string[]
  parent?: string
  comment_count?: number
  dependency_count?: number
  dependent_count?: number
  children?: string[]
  childBeads?: Bead[]
  links?: BeadLink[]
  /**
   * Ids of the OPEN beads this one waits on, from `bd blocked --json` ([] = bd says none). Undefined when bd
   * could not report it (old bd, failed call): consumers then fall back to status only.
   */
  waiting_on?: string[]
  /** Membership in `bd ready --json`; undefined when bd could not report it. */
  ready?: boolean
  spec_id?: string
  external_ref?: string
  metadata?: Record<string, string>
}

export interface RelatedBead {
  id: string
  title: string
  status: RawStatus
  issue_type: string
  dependency_type: string
}

export interface BeadDetail extends Bead {
  dependencies?: RelatedBead[]
  comments?: Comment[]
}

export interface BeadUpdate {
  title?: string
  description?: string
  acceptance_criteria?: string
  design?: string
  notes?: string
  priority?: number
  issue_type?: string
  assignee?: string
  labels?: string[]
}

export interface ProjectCounts {
  open: number
  in_progress: number
  blocked: number
  closed: number
  deferred: number
  /** Every bead the board can open, closed included. */
  total: number
  /** total minus closed; absent on error/zero placeholders. */
  active?: number
  /** What `bd ready` lists. */
  ready?: number
}

export interface Project {
  id: string
  name: string
  dir: string
  beadsPath: string
  prefix: string | null
  external: boolean
  missing: boolean
  error: string | null
  counts: ProjectCounts
  /** Registry `readonly: true`: writes are refused and the UI hides them. */
  readonly?: boolean
  /** Web only: the registry lists an https (http-snapshot) source first, which is read-only. */
  snapshotFirst?: boolean
  /** Registry `filterLabel`, only meaningful together with `readonly`. */
  filterLabel?: string
}

export type AddProjectOutcome =
  | { kind: 'registered'; project: Project }
  | { kind: 'needsInit'; path: string; suggestedPrefix: string }

export const COLUMNS: { key: BeadColumn; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'closed', label: 'Closed' },
]

export function mapStatus(raw: string): {
  column: BeadColumn
  badge?: { label: string; tone: 'warning' | 'muted' | 'info' }
} {
  switch (raw) {
    case 'open':
      return { column: 'open' }
    case 'in_progress':
      return { column: 'in_progress' }
    case 'blocked':
      return { column: 'blocked' }
    case 'closed':
      return { column: 'closed' }
    case 'deferred':
      return { column: 'open', badge: { label: 'Deferred', tone: 'muted' } }
    case 'hooked':
      return { column: 'in_progress', badge: { label: 'Hooked', tone: 'info' } }
    case 'pinned':
      return { column: 'open', badge: { label: 'Pinned', tone: 'warning' } }
    default:
      return { column: 'open' }
  }
}

/**
 * Board column of a bead. A bead waiting on an open dependency (what `bd blocked` lists) sits
 * in Blocked whatever its status, except once closed.
 */
export function beadColumn(b: Pick<Bead, 'status' | 'waiting_on'>): BeadColumn {
  const column = mapStatus(b.status).column
  return column !== 'closed' && b.waiting_on?.length ? 'blocked' : column
}

export function isEpic(b: { issue_type: string }): boolean {
  return b.issue_type === 'epic'
}

export function groupBeadLinks(links: BeadLink[] = []): {
  blockedBy: string[]
  blocking: string[]
  related: BeadLink[]
} {
  const blockedBy: string[] = []
  const blocking: string[] = []
  const related: BeadLink[] = []

  for (const link of links) {
    if (link.type === 'parent-child') continue
    if (link.type === 'blocks') {
      if (link.direction === 'outgoing') blockedBy.push(link.id)
      else blocking.push(link.id)
      continue
    }
    related.push(link)
  }

  return { blockedBy, blocking, related }
}

export type BeadFeedMessage =
  | { type: 'live'; seq: number }
  /** `ops` are the journal ops behind the change; absent or empty means unknown. */
  | { type: 'change'; seq: number; issueIds: string[]; ops?: string[] }
  | { type: 'disabled' }
  | { type: 'unsupported'; message: string }
  | { type: 'error'; message: string }
export type BeadFeedStatus =
  | 'connecting'
  | 'live'
  | 'disabled'
  | 'unsupported'
  | 'error'
