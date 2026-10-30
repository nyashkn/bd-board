import type { ArtifactFile } from '../artifacts.ts'
import type { CommentAuthor } from '../comment-author.ts'
import type {
  Bead,
  BeadDetail,
  BeadFeedMessage,
  BeadUpdate,
  Comment,
  ProjectKnowledge,
} from '../types.ts'
import type { ProjectSnapshot } from '../snapshot.ts'
import type { ConnectorKind } from './select.ts'

/** The per-project bead operations the UI needs from a data source. */
export interface Connector {
  readonly id: ConnectorKind
  listBeads: (args: { data: { project: string } }) => Promise<Bead[]>
  beadDetail: (args: {
    data: { project: string; id: string }
  }) => Promise<BeadDetail>
  projectKnowledge: (args: {
    data: { project: string }
  }) => Promise<ProjectKnowledge>
  /** Everything the UI reads, in one call: beads with comments and edges, ready, blocked, cursor. */
  snapshot: (args: { data: { project: string } }) => Promise<ProjectSnapshot>
  /** One bead's comments, to patch a snapshot after a comment-only change. */
  beadComments: (args: {
    data: { project: string; id: string }
  }) => Promise<Comment[]>
  readArtifact: (args: {
    data: { project: string; path: string }
  }) => Promise<ArtifactFile>
  subscribeFeed: (
    project: string,
    since: number,
    onMessage: (msg: BeadFeedMessage) => void,
  ) => () => void
  commentAuthor: (args: { data: { project: string } }) => Promise<CommentAuthor>
  addComment: (args: {
    data: { project: string; id: string; text: string }
  }) => Promise<{ ok: true }>
  updateStatus: (args: {
    data: { project: string; id: string; status: string }
  }) => Promise<{ ok: true }>
  updateBead: (args: {
    data: { project: string; id: string; update: BeadUpdate }
  }) => Promise<{ ok: true }>
  createBead: (args: {
    data: {
      project: string
      title: string
      description?: string
      type?: string
      parent?: string
    }
  }) => Promise<{ id: string }>
  previewDelete: (args: {
    data: { project: string; id: string }
  }) => Promise<{ preview: string }>
  deleteBead: (args: {
    data: { project: string; id: string }
  }) => Promise<{ ok: true }>
  enableEventsJournal: (args: {
    data: { project: string }
  }) => Promise<{ ok: true }>
}
