import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

import { selectBoard, selectDetail, selectKnowledge } from '@/lib/snapshot'
import { snapshotQueryOptions } from '@/lib/snapshot-store'

import type { ProjectSnapshot } from '@/lib/snapshot'

/** The board's beads, from the project snapshot. */
export function useBoardBeads(
  project: string | undefined,
  options: {
    refetchInterval?: number | false
    staleTime?: number
    refetchOnMount?: boolean
    refetchOnWindowFocus?: boolean
  } = {},
) {
  return useQuery({
    ...snapshotQueryOptions(project ?? ''),
    select: selectBoard,
    enabled: Boolean(project),
    retry: false,
    ...options,
  })
}

/** One bead's detail (dependencies, comments), from the snapshot: no `bd show`. */
export function useBeadDetail(project: string, id: string | undefined) {
  const select = useCallback(
    (s: ProjectSnapshot) => selectDetail(s, id ?? ''),
    [id],
  )
  return useQuery({
    ...snapshotQueryOptions(project),
    select,
    enabled: Boolean(id),
  })
}

/** Comments and knowledge entries, from the snapshot: no `bd export`. */
export function useKnowledge(project: string, enabled = true) {
  return useQuery({
    ...snapshotQueryOptions(project),
    select: selectKnowledge,
    enabled,
  })
}
