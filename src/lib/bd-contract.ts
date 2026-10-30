import type { BdStatus } from './bd-errors.ts'
import type { CommentAuthor } from './comment-author.ts'
import type { ProjectSnapshot } from './snapshot.ts'
import type {
  Bead,
  BeadDetail,
  BeadUpdate,
  Comment,
  Project,
  ProjectKnowledge,
} from './types.ts'

export interface BdAdapter {
  discoverProjects: () => Promise<Project[]>
  listBeads: (projectId: string) => Promise<Bead[]>
  getBeadDetail: (projectId: string, id: string) => Promise<BeadDetail>
  getProjectKnowledge: (projectId: string) => Promise<ProjectKnowledge>
  getSnapshot: (projectId: string) => Promise<ProjectSnapshot>
  getBeadComments: (projectId: string, id: string) => Promise<Comment[]>
  updateBeadStatus: (
    projectId: string,
    id: string,
    status: string,
  ) => Promise<void>
  updateBead: (projectId: string, id: string, opts: BeadUpdate) => Promise<void>
  previewDeleteBead: (projectId: string, id: string) => Promise<string>
  deleteBead: (projectId: string, id: string) => Promise<void>
  createBead: (
    projectId: string,
    opts: {
      title: string
      description?: string
      type?: string
      parent?: string
    },
  ) => Promise<string>
  addComment: (projectId: string, id: string, text: string) => Promise<void>
  enableEventsJournal: (projectId: string) => Promise<void>
  getCommentAuthor: (projectId: string) => Promise<CommentAuthor>
  getBdStatus: () => Promise<BdStatus>
}
