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

// `bd export` is the costliest read. It never goes stale on its own: the bead feed, a user
// write or a panel's refetchInterval refreshes it, so opening or switching beads is free.
export const projectKnowledgeQueryOptions = (project: string) =>
  queryOptions({
    queryKey: ['project-knowledge', project],
    queryFn: () =>
      connectorFor(project).projectKnowledge({ data: { project } }),
    staleTime: Infinity,
  })
