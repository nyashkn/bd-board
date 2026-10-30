import {
  addCommentFn,
  createBeadFn,
  deleteBeadFn,
  enableEventsJournalFn,
  getBeadDetailFn,
  getBeadCommentsFn,
  getBeads,
  getCommentAuthorFn,
  getProjectKnowledgeFn,
  getSnapshotFn,
  previewDeleteBeadFn,
  readArtifactFn,
  subscribeBeadFeed,
  updateBeadFn,
  updateBeadStatusFn,
} from '../server.ts'

import type { Connector } from './types.ts'

// The members are the tracked server.ts exports themselves, so RUM labels are unchanged.
export const bdCli: Connector = {
  id: 'bd-cli',
  listBeads: getBeads,
  beadDetail: getBeadDetailFn,
  projectKnowledge: getProjectKnowledgeFn,
  snapshot: getSnapshotFn,
  beadComments: getBeadCommentsFn,
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
