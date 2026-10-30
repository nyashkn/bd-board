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
    // A fetch that already has data to show is a refresh nobody waits on: it takes the
    // background lane in the bd queue. The first load (the user is waiting) stays a user call.
    queryFn: ({ client }) =>
      connectorFor(project).snapshot({
        data: {
          project,
          background: client.getQueryData(snapshotKey(project)) !== undefined,
        },
      }),
    staleTime: Infinity,
    refetchOnMount: false,
  })

// Whether each project's feed is live: decides if a write waits for the feed or refetches.
const live = new Map<string, boolean>()
export const setFeedLive = (project: string, value: boolean) =>
  live.set(project, value)
export const isFeedLive = (project: string) => live.get(project) === true

/**
 * Refetch, cancelling a fetch already in flight: that one may have started before the change
 * that asked for this refresh (a mount refetch, a hover prefetch), so joining it would count the
 * refresh as done on stale data. The backends coalesce, so no extra bd process piles up.
 */
export const refreshSnapshot = (client: QueryClient, project: string) =>
  client.refetchQueries(
    { queryKey: snapshotKey(project) },
    { cancelRefetch: true },
  )

/** Above this many beads one snapshot is cheaper than a `bd comments` call each. */
export const MAX_COMMENT_FETCHES = 3

/** Comment-only change: fetch those beads' comments and patch; a bead we lack means a full refresh. */
export async function refreshComments(
  client: QueryClient,
  project: string,
  ids: string[],
): Promise<void> {
  if (ids.length > MAX_COMMENT_FETCHES)
    return void (await refreshSnapshot(client, project))
  const connector = connectorFor(project)
  try {
    for (const id of ids) {
      const comments = await connector.beadComments({
        data: { project, id, background: true },
      })
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
  // Cancelling drops a refresh the feed asked for without a trace (refetchQueries swallows it);
  // remember it so settleWrite runs it again.
  if (client.getQueryState(key)?.fetchStatus === 'fetching')
    interrupted.add(project)
  await client.cancelQueries({ queryKey: key })
  const before = client.getQueryData<ProjectSnapshot>(key)
  if (before) client.setQueryData(key, patch(before))
  return () => {
    if (before) client.setQueryData(key, before)
  }
}

// Projects whose in-flight refresh a write cancelled.
const interrupted = new Set<string>()

/**
 * After a write: with a live feed its change event confirms, otherwise refetch (the old fallback).
 * A refresh the write cancelled is run again either way.
 */
export function settleWrite(client: QueryClient, project: string): void {
  if (interrupted.delete(project) || !isFeedLive(project))
    void client.invalidateQueries(
      { queryKey: snapshotKey(project) },
      { cancelRefetch: false },
    )
}
