import { queryOptions } from '@tanstack/react-query'

import { connectorFor } from '@/lib/core'
import { setComments } from '@/lib/snapshot'

import type { QueryClient } from '@tanstack/react-query'
import type { ProjectSnapshot } from '@/lib/snapshot'

/**
 * The project snapshot in the query cache: one key per project. Everything the UI shows about
 * beads is a selector over it, so opening or switching a bead makes no bd call. The bead feed
 * keeps it fresh (see use-bead-feed.ts and snapshot-refresh.ts); writes patch it.
 */
export const snapshotKey = (project: string) => ['snapshot', project] as const

// Never stale on its own, and mounting another observer (the modal, a panel) never refetches.
// The board route sets a short staleTime of its own to revalidate when entering a project.
export const snapshotQueryOptions = (project: string) =>
  queryOptions({
    queryKey: snapshotKey(project),
    queryFn: () => connectorFor(project).snapshot({ data: { project } }),
    staleTime: Infinity,
    refetchOnMount: false,
  })

// Whether each project's feed is live: decides if a write waits for the feed or refetches.
const live = new Map<string, boolean>()
export const setFeedLive = (project: string, value: boolean) =>
  live.set(project, value)
export const isFeedLive = (project: string) => live.get(project) === true

/** Refetch without cancelling a running bd process; joins it instead. */
export const refreshSnapshot = (client: QueryClient, project: string) =>
  client.refetchQueries(
    { queryKey: snapshotKey(project) },
    { cancelRefetch: false },
  )

/** Comment-only change: fetch those beads' comments and patch; a bead we lack means a full refresh. */
export async function refreshComments(
  client: QueryClient,
  project: string,
  ids: string[],
): Promise<void> {
  const connector = connectorFor(project)
  try {
    for (const id of ids) {
      const comments = await connector.beadComments({ data: { project, id } })
      const current = client.getQueryData<ProjectSnapshot>(snapshotKey(project))
      if (!current?.beads.some((b) => b.id === id)) {
        await refreshSnapshot(client, project)
        return
      }
      client.setQueryData<ProjectSnapshot>(
        snapshotKey(project),
        setComments(current, id, comments),
      )
    }
  } catch {
    await refreshSnapshot(client, project)
  }
}

/**
 * Patch the cached snapshot before the write answers. In-flight refreshes are cancelled first so
 * a stale result cannot overwrite the patch. Returns the rollback for a failed write.
 */
export async function patchSnapshot(
  client: QueryClient,
  project: string,
  patch: (snapshot: ProjectSnapshot) => ProjectSnapshot,
): Promise<() => void> {
  const key = snapshotKey(project)
  await client.cancelQueries({ queryKey: key })
  const before = client.getQueryData<ProjectSnapshot>(key)
  if (before) client.setQueryData(key, patch(before))
  return () => {
    if (before) client.setQueryData(key, before)
  }
}

/** After a write: with a live feed its change event confirms, otherwise refetch (the old fallback). */
export function settleWrite(client: QueryClient, project: string): void {
  if (!isFeedLive(project))
    void client.invalidateQueries(
      { queryKey: snapshotKey(project) },
      { cancelRefetch: false },
    )
}
