import { queryOptions } from '@tanstack/react-query'

import { connectorFor } from '@/lib/core'
import { getProjects } from '@/lib/server'

export const PROJECTS_POLL_MS = 15_000

// One shared definition: observers dedupe the fetch, and only the root rail polls (see PROJECTS_POLL_MS).
export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    staleTime: PROJECTS_POLL_MS,
  })

// The palette's cross-project comment index, for projects whose snapshot is not cached. The open
// project reads comments from its snapshot instead (src/lib/snapshot.ts).
export const projectKnowledgeQueryOptions = (project: string) =>
  queryOptions({
    queryKey: ['project-knowledge', project],
    queryFn: () =>
      connectorFor(project).projectKnowledge({ data: { project } }),
    staleTime: Infinity,
  })
