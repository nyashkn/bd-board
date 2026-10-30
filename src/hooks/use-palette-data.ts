import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { connectorFor } from '@/lib/core'
import {
  projectKnowledgeQueryOptions,
  projectsQueryOptions,
} from '@/lib/query-options'
import { askingBeads } from '@/lib/bead-questions'
import { buildDocs, indexComments, replaceAsking } from '@/lib/palette-search'
import { rumDuration, rumNow } from '@/lib/rum'

import type { IndexedText, PaletteDoc } from '@/lib/palette-search'

const MAX_PROJECTS = 24
const MAX_COMMENT_PROJECTS = 12
const COMMENT_CONCURRENCY = 2
const COMMENT_START_DELAY_MS = 250

export interface PaletteData {
  /** Registered projects the palette can search, current first. */
  projects: { id: string; name: string }[]
  docs: PaletteDoc[]
  comments: Map<string, IndexedText[]>
  /** Doc keys with an unanswered `stopped` question (`is:asking`), from the indexed comments. */
  asking: Set<string>
  /** Beads still loading for at least one project. */
  loading: boolean
  /** Comments are being fetched in the background. */
  indexing: boolean
}

/**
 * Everything the palette searches, read through the same query keys the board uses (so beads
 * already on screen cost nothing). Comments come from the read-only project export, lazily:
 * only once the palette is open and the beads are in, two projects at a time, at most 12.
 */
export function usePaletteData(open: boolean, current?: string): PaletteData {
  const queryClient = useQueryClient()
  const projectsQuery = useQuery({
    ...projectsQueryOptions(),
    enabled: open,
  })

  const projects = useMemo(() => {
    const live = (projectsQuery.data ?? []).filter(
      (p) => !p.missing && !p.error,
    )
    // The current project first so its comments are indexed before the others.
    return [
      ...live.filter((p) => p.id === current),
      ...live.filter((p) => p.id !== current),
    ].slice(0, MAX_PROJECTS)
  }, [projectsQuery.data, current])

  const beads = useQueries({
    queries: projects.map((p) => ({
      queryKey: ['beads', p.id],
      queryFn: () => connectorFor(p.id).listBeads({ data: { project: p.id } }),
      staleTime: 30_000,
      retry: false,
      enabled: open,
    })),
    combine: (results) => ({
      data: results.map((r) => r.data),
      loading: results.some((r) => r.isLoading),
    }),
  })

  const docs = useMemo(() => {
    const t0 = rumNow()
    const built = projects.flatMap((p, i) =>
      buildDocs({ id: p.id, name: p.name }, beads.data[i] ?? []),
    )
    if (built.length)
      rumDuration('palette.index.build', t0, { docs: built.length })
    return built
  }, [projects, beads.data])

  const [comments, setComments] = useState(
    () => new Map<string, IndexedText[]>(),
  )
  const [asking, setAsking] = useState(() => new Set<string>())
  const [indexing, setIndexing] = useState(false)
  const loading = beads.loading || projectsQuery.isLoading
  const projectKey = projects.map((p) => p.id).join()

  useEffect(() => {
    if (!open || loading || !projectKey) return
    const run = { cancelled: false }
    const stopped = () => run.cancelled
    const queue = projectKey.split(',').slice(0, MAX_COMMENT_PROJECTS)

    async function worker() {
      for (let id = queue.shift(); id && !stopped(); id = queue.shift()) {
        try {
          const project = id
          const knowledge = await queryClient.fetchQuery(
            projectKnowledgeQueryOptions(project),
          )
          if (stopped()) return
          const t0 = rumNow()
          const index = indexComments(project, knowledge.comments)
          rumDuration('palette.index.comments', t0, {
            comments: knowledge.comments.length,
          })
          setComments((prev) => new Map([...prev, ...index]))
          const ask = askingBeads(knowledge.comments)
          setAsking((prev) => replaceAsking(prev, project, ask))
        } catch {
          // one project failing to export must not stop the others
        }
      }
    }

    const timer = setTimeout(() => {
      setIndexing(true)
      void Promise.all(
        Array.from({ length: COMMENT_CONCURRENCY }, worker),
      ).then(() => {
        if (!stopped()) setIndexing(false)
      })
    }, COMMENT_START_DELAY_MS)
    return () => {
      run.cancelled = true
      clearTimeout(timer)
      setIndexing(false)
    }
  }, [open, loading, projectKey, queryClient])

  return {
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    docs,
    comments,
    asking,
    loading,
    indexing,
  }
}
