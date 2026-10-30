import {
  addCommentFn,
  createBeadFn,
  deleteBeadFn,
  enableEventsJournalFn,
  getBeadDetailFn,
  getBeads,
  getCommentAuthorFn,
  getProjectKnowledgeFn,
  previewDeleteBeadFn,
  readArtifactFn,
  subscribeBeadFeed,
  updateBeadFn,
  updateBeadStatusFn,
} from './server.ts'

import type { ArtifactFile } from './artifacts.ts'
import type { CommentAuthor } from './comment-author.ts'
import type {
  Bead,
  BeadDetail,
  BeadFeedMessage,
  BeadUpdate,
  ProjectKnowledge,
} from './types.ts'

/** The per-project bead operations the UI needs from a data source. */
export interface Connector {
  readonly id: 'bd-cli'
  listBeads: (args: { data: { project: string } }) => Promise<Bead[]>
  beadDetail: (args: {
    data: { project: string; id: string }
  }) => Promise<BeadDetail>
  projectKnowledge: (args: {
    data: { project: string }
  }) => Promise<ProjectKnowledge>
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

// The members are the tracked server.ts exports themselves, so RUM labels are unchanged.
export const bdCli: Connector = {
  id: 'bd-cli',
  listBeads: getBeads,
  beadDetail: getBeadDetailFn,
  projectKnowledge: getProjectKnowledgeFn,
  readArtifact: readArtifactFn,
  subscribeFeed: subscribeBeadFeed,
  commentAuthor: getCommentAuthorFn,
  addComment: addCommentFn,
  updateStatus: updateBeadStatusFn,
  updateBead: updateBeadFn,
  createBead: createBeadFn,
  previewDelete: previewDeleteBeadFn,
  deleteBead: deleteBeadFn,
  enableEventsJournal: enableEventsJournalFn,
}

// Automatic selection (configured URL scheme, then a capability probe, then fallback to
// bd-cli) lands here.
export function connectorFor(_project: string): Connector {
  return bdCli
}
