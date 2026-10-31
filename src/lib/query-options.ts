import { queryOptions } from '@tanstack/react-query'

import { connectorFor } from '@/lib/core'
import { getProjects } from '@/lib/server'

export const PROJECTS_STALE_MS = 15_000
// Safety net for projects with no loaded snapshot (no cursor): agents' writes there still reach the counts.
export const PROJECTS_FALLBACK_MS = 60_000

// One shared definition: observers dedupe the fetch. The rail refetches it when a snapshot cursor
// moves (refetchProjectsOnCursorMove, throttled), after project-level writes, and every
// PROJECTS_FALLBACK_MS.
export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: ['projects'],
    queryFn: () => getProjects(),
    staleTime: PROJECTS_STALE_MS,
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
